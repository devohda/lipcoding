const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("./db");
const swaggerUi = require("swagger-ui-express");
const swaggerJSDoc = require("swagger-jsdoc");
const app = express();
const PORT = 8080;
const SECRET = "secret-key";
const { v4: uuidv4 } = require("uuid"); // JWT jti용
const path = require("path");
const fs = require("fs");
const multer = require("multer");

// 프로필 이미지 업로드용 multer 설정
const upload = multer({
	storage: multer.diskStorage({
		destination: function (req, file, cb) {
			cb(null, path.join(__dirname, "uploads/profile"));
		},
		filename: function (req, file, cb) {
			const ext = path.extname(file.originalname);
			cb(null, `user_${req.user.sub}${ext}`);
		},
	}),
	limits: { fileSize: 1024 * 1024 }, // 1MB 제한
	fileFilter: (req, file, cb) => {
		if (["image/jpeg", "image/png"].includes(file.mimetype)) cb(null, true);
		else cb(new Error("jpg 또는 png 파일만 허용됩니다."));
	},
});

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

app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ extended: true, limit: "200mb" }));
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
	const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
	if (!email || !password || !name || !role || !emailRegex.test(email)) {
		return res.status(400).json({ error: "Invalid payload" });
	}
	if (role !== "mentor" && role !== "mentee") {
		return res.status(400).json({ error: "Invalid role" });
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
	if (!email || !password) {
		return res.status(401).json({ error: "Unauthorized" });
	}
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
				imageUrl: `/api/images/mentor/${user.id}`,
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
		`SELECT mr.id, mr.mentorId, mr.menteeId, u.name as menteeName, u.email as menteeEmail, mr.message, mr.status
		 FROM match_requests mr
		 JOIN users u ON mr.menteeId = u.id
		 WHERE mr.mentorId = ?
		 ORDER BY mr.id DESC`,
		[req.user.sub],
		(err, rows) => {
			if (err) return res.status(500).json({ error: "DB error" });
			const result = rows.map((row) => ({
				...row,
				mentorId: Number(req.user.sub),
			}));
			res.json(result);
		}
	);
});
// 멘티가 보낸 매칭 요청 목록 조회
app.get("/api/match-requests/outgoing", auth, (req, res) => {
	if (req.user.role !== "mentee")
		return res.status(403).json({ error: "멘티만 조회할 수 있습니다." });
	db.all(
		`SELECT mr.id, mr.mentorId, mr.menteeId, mr.status
		 FROM match_requests mr
		 WHERE mr.menteeId = ?
		 ORDER BY mr.id DESC`,
		[req.user.sub],
		(err, rows) => {
			if (err) return res.status(500).json({ error: "DB error" });
			res.json(rows);
		}
	);
});
// 매칭 요청 수락 (멘토 전용)
app.put("/api/match-requests/:id/accept", auth, (req, res) => {
	if (req.user.role !== "mentor")
		return res.status(403).json({ error: "멘토만 수락할 수 있습니다." });
	const { id } = req.params;
	db.get(
		`SELECT * FROM match_requests WHERE id = ? AND mentorId = ?`,
		[id, req.user.sub],
		(err, row) => {
			if (!row) return res.status(404).json({ error: "Not found" });
			db.run(
				`UPDATE match_requests SET status = 'accepted' WHERE id = ?`,
				[id],
				function (err) {
					if (err) return res.status(500).json({ error: "DB error" });
					db.get(
						`SELECT * FROM match_requests WHERE id = ?`,
						[id],
						(err, updatedRow) => {
							if (!updatedRow)
								return res.status(404).json({ error: "Not found" });
							res.json(updatedRow);
						}
					);
				}
			);
		}
	);
});
// 매칭 요청 거절 (멘토 전용)
app.put("/api/match-requests/:id/reject", auth, (req, res) => {
	if (req.user.role !== "mentor")
		return res.status(403).json({ error: "멘토만 거절할 수 있습니다." });
	const { id } = req.params;
	db.get(
		`SELECT * FROM match_requests WHERE id = ? AND mentorId = ?`,
		[id, req.user.sub],
		(err, row) => {
			if (!row) return res.status(404).json({ error: "Not found" });
			db.run(
				`UPDATE match_requests SET status = 'rejected' WHERE id = ?`,
				[id],
				function (err) {
					if (err) return res.status(500).json({ error: "DB error" });
					db.get(
						`SELECT * FROM match_requests WHERE id = ?`,
						[id],
						(err, updatedRow) => {
							if (!updatedRow)
								return res.status(404).json({ error: "Not found" });
							res.json(updatedRow);
						}
					);
				}
			);
		}
	);
});
// 매칭 요청 삭제/취소 (멘티 전용)
app.delete("/api/match-requests/:id", auth, (req, res) => {
	if (req.user.role !== "mentee")
		return res.status(403).json({ error: "멘티만 취소할 수 있습니다." });
	const { id } = req.params;
	db.get(
		`SELECT * FROM match_requests WHERE id = ? AND menteeId = ?`,
		[id, req.user.sub],
		(err, row) => {
			if (!row) return res.status(404).json({ error: "Not found" });
			db.run(
				`UPDATE match_requests SET status = 'cancelled' WHERE id = ?`,
				[id],
				function (err) {
					if (err) return res.status(500).json({ error: "DB error" });
					row.status = "cancelled";
					res.json(row);
				}
			);
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

/**
 * @swagger
 * /api/images/{role}/{id}:
 *   get:
 *     summary: 프로필 이미지 제공
 *     tags:
 *       - User
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: role
 *         required: true
 *         schema:
 *           type: string
 *         description: 사용자 역할 (mentor, mentee)
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 사용자 ID
 *     responses:
 *       302:
 *         description: 이미지 리다이렉트
 *       400:
 *         description: 잘못된 요청
 *       401:
 *         description: 인증 실패
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

// 프로필 이미지 제공 (임시: placeholder)
app.get("/api/images/:role/:id", auth, (req, res) => {
	const { role, id } = req.params;
	// 실제 구현에서는 DB에서 파일 경로를 조회하거나, 파일 시스템에서 이미지를 읽어야 함
	// 여기서는 임시로 placeholder 이미지를 반환
	if (role !== "mentor" && role !== "mentee") {
		return res.status(400).json({ error: "Invalid role" });
	}
	db.get(
		"SELECT imageUrl FROM users WHERE id = ? AND role = ?",
		[id, role],
		(err, row) => {
			if (!row || !row.imageUrl) {
				const url =
					role === "mentor"
						? "https://placehold.co/500x500.jpg?text=MENTOR"
						: "https://placehold.co/500x500.jpg?text=MENTEE";
				return res.redirect(url);
			}
			if (row.imageUrl.startsWith("/uploads/profile/")) {
				const filePath = path.join(__dirname, row.imageUrl);
				fs.access(filePath, fs.constants.F_OK, (err) => {
					if (err) {
						const url =
							role === "mentor"
								? "https://placehold.co/500x500.jpg?text=MENTOR"
								: "https://placehold.co/500x500.jpg?text=MENTEE";
						return res.redirect(url);
					}
					res.sendFile(filePath);
				});
			} else {
				res.redirect(row.imageUrl);
			}
		}
	);
});

// 프로필 수정 (PUT /api/profile)
app.put("/api/profile", auth, (req, res) => {
	const { id, name, role, bio, image, skills } = req.body;
	if (!id || !name || !role || !bio) {
		return res.status(400).json({ error: "Invalid payload" });
	}
	if (role !== "mentor" && role !== "mentee") {
		return res.status(400).json({ error: "Invalid role" });
	}
	if (String(req.user.sub) !== String(id)) {
		return res.status(401).json({ error: "Unauthorized" });
	}
	let imageUrl = `/api/images/${role}/${id}`;
	let skillsStr = null;
	if (role === "mentor") {
		skillsStr = Array.isArray(skills) ? JSON.stringify(skills) : "[]";
	}
	db.run(
		"UPDATE users SET name = ?, bio = ?, imageUrl = ?, skills = ? WHERE id = ?",
		[
			escapeHtml(name),
			escapeHtml(bio),
			imageUrl,
			role === "mentor" ? skillsStr : null,
			id,
		],
		function (err) {
			if (err) return res.status(500).json({ error: "DB error" });
			db.get("SELECT * FROM users WHERE id = ?", [id], (err, user) => {
				if (!user) return res.status(500).json({ error: "Not found" });
				const profile = {
					name: user.name,
					bio: user.bio,
					imageUrl: `/api/images/${user.role}/${user.id}`,
				};
				if (user.role === "mentor") {
					profile.skills = JSON.parse(user.skills || "[]");
				}
				res.json({
					id: user.id,
					email: user.email,
					role: user.role,
					profile,
				});
			});
		}
	);
});

// 프로필 이미지 업로드 (POST /api/me/image)
app.post("/api/me/image", auth, upload.single("profile"), (req, res) => {
	if (!req.file) {
		return res.status(400).json({ error: "파일이 업로드되지 않았습니다." });
	}
	const ext = path.extname(req.file.filename);
	const imageUrl = `/uploads/profile/${req.file.filename}`;
	db.run(
		"UPDATE users SET imageUrl = ? WHERE id = ?",
		[imageUrl, req.user.sub],
		function (err) {
			if (err) return res.status(500).json({ error: "DB error" });
			res.json({ message: "이미지 업로드 성공", imageUrl });
		}
	);
});

// 업로드된 프로필 이미지 제공
app.get("/uploads/profile/:filename", (req, res) => {
	const filePath = path.join(__dirname, "uploads/profile", req.params.filename);
	fs.access(filePath, fs.constants.F_OK, (err) => {
		if (err) {
			return res
				.status(404)
				.sendFile(
					path.join(__dirname, "..", "frontend", "profile-placeholder.png")
				);
		}
		res.sendFile(filePath);
	});
});

// /api/images/:role/:id에서 실제 업로드 이미지 제공
app.get("/api/images/:role/:id", auth, (req, res) => {
	const { role, id } = req.params;
	if (role !== "mentor" && role !== "mentee") {
		return res.status(400).json({ error: "Invalid role" });
	}
	db.get(
		"SELECT imageUrl FROM users WHERE id = ? AND role = ?",
		[id, role],
		(err, row) => {
			if (!row || !row.imageUrl) {
				const url =
					role === "mentor"
						? "https://placehold.co/500x500.jpg?text=MENTOR"
						: "https://placehold.co/500x500.jpg?text=MENTEE";
				return res.redirect(url);
			}
			if (row.imageUrl.startsWith("/uploads/profile/")) {
				const filePath = path.join(__dirname, row.imageUrl);
				fs.access(filePath, fs.constants.F_OK, (err) => {
					if (err) {
						const url =
							role === "mentor"
								? "https://placehold.co/500x500.jpg?text=MENTOR"
								: "https://placehold.co/500x500.jpg?text=MENTEE";
						return res.redirect(url);
					}
					res.sendFile(filePath);
				});
			} else {
				res.redirect(row.imageUrl);
			}
		}
	);
});

app.listen(PORT, () => {
	console.log(`Server is running on http://localhost:${PORT}`);
});

// 404 Not Found 핸들러 (가장 마지막에 추가)
app.use((req, res, next) => {
	console.log("404 Not Found:", req.method, req.originalUrl);
	res.status(404).json({ error: "Not Found" });
});
