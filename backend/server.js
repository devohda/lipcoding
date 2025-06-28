const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("./db");
const swaggerUi = require("swagger-ui-express");
const swaggerJSDoc = require("swagger-jsdoc");
const app = express();
const PORT = 8080;
const SECRET = "secret-key";
const { v4: uuidv4 } = require("uuid"); // JWT jti용

const swaggerDefinition = {
	openapi: "3.0.0",
	info: {
		title: "Mentor-Mentee API",
		version: "1.0.0",
		description: "멘토-멘티 매칭 앱 API 명세서 (Node.js Express)",
	},
	servers: [{ url: "http://localhost:8080" }],
};
const options = {
	swaggerDefinition,
	apis: [__filename],
};
const swaggerSpec = swaggerJSDoc(options);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use(express.json());
// CORS 허용 (프론트엔드 3000번 포트)
app.use((req, res, next) => {
	res.header("Access-Control-Allow-Origin", "http://localhost:3000");
	res.header(
		"Access-Control-Allow-Methods",
		"GET,POST,PUT,PATCH,DELETE,OPTIONS"
	);
	res.header(
		"Access-Control-Allow-Headers",
		"Origin, X-Requested-With, Content-Type, Accept, Authorization"
	);
	if (req.method === "OPTIONS") return res.sendStatus(200);
	next();
});
app.post("/api/signup", (req, res) => {
	const { email, password, name, role } = req.body;
	if (!email || !password || !name || !role) {
		return res.status(400).json({ error: "Invalid payload" });
	}
	db.get("SELECT id FROM users WHERE email = ?", [email], (err, row) => {
		if (row) return res.status(400).json({ error: "Email already exists" });
		db.run(
			`INSERT INTO users (email, password, role, name, bio, imageUrl, skills) VALUES (?, ?, ?, ?, '', ?, ?)`,
			[
				email,
				password,
				role,
				escapeHtml(name),
				role === "mentor"
					? "https://placehold.co/500x500.jpg?text=MENTOR"
					: "https://placehold.co/500x500.jpg?text=MENTEE",
				role === "mentor" ? JSON.stringify([]) : null,
			],
			function (err) {
				if (err) return res.status(500).json({ error: "DB error" });
				res.status(201).json({ message: "Signup success" });
			}
		);
	});
});
app.post("/api/login", (req, res) => {
	const { email, password } = req.body;
	db.get(
		"SELECT * FROM users WHERE email = ? AND password = ?",
		[email, password],
		(err, user) => {
			if (!user) return res.status(401).json({ error: "Unauthorized" });
			const now = Math.floor(Date.now() / 1000);
			const token = jwt.sign(
				{
					iss: "mentor-mentee-app",
					sub: String(user.id),
					aud: "mentor-mentee-client",
					exp: now + 60 * 60,
					nbf: now,
					iat: now,
					jti: uuidv4(),
					name: user.name,
					email: user.email,
					role: user.role,
				},
				SECRET
			);
			res.json({ token });
		}
	);
});
function auth(req, res, next) {
	const authHeader = req.headers["authorization"];
	if (!authHeader) return res.status(401).json({ error: "No token" });
	const token = authHeader.split(" ")[1];
	try {
		req.user = jwt.verify(token, SECRET);
		next();
	} catch {
		res.status(401).json({ error: "Invalid token" });
	}
}
app.get("/api/me", auth, (req, res) => {
	db.get("SELECT * FROM users WHERE id = ?", [req.user.sub], (err, user) => {
		if (!user) return res.status(401).json({ error: "Not found" });
		res.json({
			id: user.id,
			email: user.email,
			role: user.role,
			profile: {
				name: user.name,
				bio: user.bio,
				imageUrl: user.imageUrl,
				skills:
					user.role === "mentor" ? JSON.parse(user.skills || "[]") : undefined,
			},
		});
	});
});
app.patch("/api/me", auth, (req, res) => {
	const { profile } = req.body;
	if (!profile) return res.status(400).json({ error: "Invalid payload" });
	db.get("SELECT * FROM users WHERE id = ?", [req.user.sub], (err, user) => {
		if (!user) return res.status(401).json({ error: "Not found" });
		const name =
			profile.name !== undefined ? escapeHtml(profile.name) : user.name;
		const bio = profile.bio !== undefined ? escapeHtml(profile.bio) : user.bio;
		const imageUrl =
			profile.imageUrl !== undefined ? profile.imageUrl : user.imageUrl;
		const skills =
			user.role === "mentor" && profile.skills !== undefined
				? JSON.stringify(profile.skills)
				: user.skills;
		db.run(
			"UPDATE users SET name = ?, bio = ?, imageUrl = ?, skills = ? WHERE id = ?",
			[name, bio, imageUrl, skills, user.id],
			function (err) {
				if (err) return res.status(500).json({ error: "DB error" });
				res.json({
					message: "Profile updated",
					profile: {
						name,
						bio,
						imageUrl,
						skills:
							user.role === "mentor" ? JSON.parse(skills || "[]") : undefined,
					},
				});
			}
		);
	});
});
app.get("/api/mentors", auth, (req, res) => {
	let sql = "SELECT * FROM users WHERE role = 'mentor'";
	const params = [];
	if (req.query.skill) {
		sql += " AND skills LIKE ?";
		params.push(`%${req.query.skill}%`);
	}
	if (req.query.order_by === "name") {
		sql += " ORDER BY name COLLATE NOCASE";
	} else if (req.query.order_by === "skill") {
		sql += " ORDER BY skills COLLATE NOCASE";
	}
	db.all(sql, params, (err, rows) => {
		if (err) return res.status(500).json({ error: "DB error" });
		const mentors = rows.map((user) => ({
			id: user.id,
			email: user.email,
			role: user.role,
			profile: {
				name: user.name,
				bio: user.bio,
				imageUrl: user.imageUrl,
				skills: JSON.parse(user.skills || "[]"),
			},
		}));
		res.json(mentors);
	});
});
app.post("/api/match-requests", auth, (req, res) => {
	if (req.user.role !== "mentee")
		return res.status(403).json({ error: "Forbidden" });
	const { mentorId, menteeId, message } = req.body;
	if (!mentorId || !menteeId || !message)
		return res.status(400).json({ error: "Invalid payload" });
	db.get(
		"SELECT id FROM users WHERE id = ? AND role = 'mentor'",
		[mentorId],
		(err, mentor) => {
			if (!mentor) return res.status(400).json({ error: "Mentor not found" });
			db.run(
				"INSERT INTO match_requests (mentorId, menteeId, message, status) VALUES (?, ?, ?, 'pending')",
				[mentorId, menteeId, escapeHtml(message)],
				function (err) {
					if (err) return res.status(500).json({ error: "DB error" });
					res.json({
						id: this.lastID,
						mentorId,
						menteeId,
						message: escapeHtml(message),
						status: "pending",
					});
				}
			);
		}
	);
});
// 멘토가 받은 매칭 요청 목록 조회
app.get("/api/match-requests/incoming", auth, (req, res) => {
	if (req.user.role !== "mentor")
		return res.status(403).json({ error: "멘토만 조회할 수 있습니다." });
	db.all(
		`SELECT mr.id, mr.menteeId, u.name as menteeName, u.email as menteeEmail, mr.message, mr.status
		 FROM match_requests mr
		 JOIN users u ON mr.menteeId = u.id
		 WHERE mr.mentorId = ?
		 ORDER BY mr.id DESC`,
		[req.user.sub],
		(err, rows) => {
			if (err) return res.status(500).json({ error: "DB error" });
			res.json(rows);
		}
	);
});
/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */

/**
 * @swagger
 * /api/match-requests/incoming:
 *   get:
 *     summary: 멘토가 받은 매칭 요청 목록 조회
 *     tags:
 *       - MatchRequests
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 매칭 요청 목록
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   menteeId:
 *                     type: integer
 *                   menteeName:
 *                     type: string
 *                   menteeEmail:
 *                     type: string
 *                   message:
 *                     type: string
 *                   status:
 *                     type: string
 *       401:
 *         description: 인증 실패
 *       403:
 *         description: 멘토만 접근 가능
 */

/**
 * @swagger
 * /api/signup:
 *   post:
 *     summary: 회원가입
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               name:
 *                 type: string
 *               role:
 *                 type: string
 *     responses:
 *       201:
 *         description: 회원가입 성공
 *       400:
 *         description: 잘못된 요청
 */

/**
 * @swagger
 * /api/login:
 *   post:
 *     summary: 로그인
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: 로그인 성공(JWT 반환)
 *       401:
 *         description: 인증 실패
 */

/**
 * @swagger
 * /api/me:
 *   get:
 *     summary: 내 정보 조회
 *     tags:
 *       - User
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 내 정보
 *       401:
 *         description: 인증 실패
 *   patch:
 *     summary: 내 프로필 수정
 *     tags:
 *       - User
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               profile:
 *                 type: object
 *     responses:
 *       200:
 *         description: 수정 성공
 *       400:
 *         description: 잘못된 요청
 *       401:
 *         description: 인증 실패
 */

/**
 * @swagger
 * /api/mentors:
 *   get:
 *     summary: 멘토 목록 조회
 *     tags:
 *       - Mentor
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: skill
 *         schema:
 *           type: string
 *         description: 기술스택 필터
 *       - in: query
 *         name: order_by
 *         schema:
 *           type: string
 *         description: 정렬 기준(name, skill)
 *     responses:
 *       200:
 *         description: 멘토 목록
 *       401:
 *         description: 인증 실패
 */

/**
 * @swagger
 * /api/match-requests:
 *   post:
 *     summary: 매칭 요청 생성(멘티 전용)
 *     tags:
 *       - MatchRequests
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               mentorId:
 *                 type: integer
 *               menteeId:
 *                 type: integer
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: 요청 성공
 *       400:
 *         description: 잘못된 요청
 *       403:
 *         description: 멘티만 가능
 *       500:
 *         description: DB 오류
 */

// 루트 접속 시 Swagger UI로 리다이렉트
app.get("/", (req, res) => {
	res.redirect("/api-docs");
});
// OpenAPI JSON 문서 제공
app.get("/openapi.json", (req, res) => {
	res.setHeader("Content-Type", "application/json");
	res.send(swaggerSpec);
});

// XSS 방지용 escape 함수
function escapeHtml(str) {
	if (typeof str !== "string") return str;
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

app.listen(PORT, () => {
	console.log(`Server is running on http://localhost:${PORT}`);
});
