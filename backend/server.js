const express = require("express");
const jwt = require("jsonwebtoken");
const { users, matchRequests } = require("./data");
const swaggerUi = require("swagger-ui-express");
const swaggerJSDoc = require("swagger-jsdoc");
const app = express();
const PORT = 8080;
const SECRET = "secret-key";

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
/**
 * @swagger
 * /api/signup:
 *   post:
 *     summary: 회원가입
 *     description: 이메일, 비밀번호, 이름, 역할(mentor/mentee)로 회원가입
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - name
 *               - role
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               name:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [mentor, mentee]
 *     responses:
 *       201:
 *         description: 회원가입 성공
 *       400:
 *         description: 잘못된 요청 또는 이메일 중복
 */

// 회원가입
app.post("/api/signup", (req, res) => {
	const { email, password, name, role } = req.body;
	if (!email || !password || !name || !role) {
		return res.status(400).json({ error: "Invalid payload" });
	}
	if (users.find((u) => u.email === email)) {
		return res.status(400).json({ error: "Email already exists" });
	}
	const id = users.length + 1;
	users.push({
		id,
		email,
		password,
		role,
		profile: {
			name,
			bio: "",
			imageUrl:
				role === "mentor" ? `/images/mentor/${id}` : `/images/mentee/${id}`,
			skills: role === "mentor" ? [] : undefined,
		},
	});
	res.status(201).json({ message: "Signup success" });
});
/**
 * @swagger
 * /api/login:
 *   post:
 *     summary: 로그인
 *     description: 이메일과 비밀번호로 로그인, JWT 토큰 반환
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: 로그인 성공, 토큰 반환
 *       401:
 *         description: 인증 실패
 */

// 로그인
app.post("/api/login", (req, res) => {
	const { email, password } = req.body;
	const user = users.find((u) => u.email === email && u.password === password);
	if (!user) return res.status(401).json({ error: "Unauthorized" });
	const token = jwt.sign(
		{
			id: user.id,
			email: user.email,
			role: user.role,
			name: user.profile.name,
		},
		SECRET,
		{ expiresIn: "1h" }
	);
	res.json({ token });
});

// 인증 미들웨어
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
/**
 * @swagger
 * /api/me:
 *   get:
 *     summary: 내 정보 조회
 *     description: JWT 인증 필요, 내 계정 정보 반환
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 내 정보 반환
 *       401:
 *         description: 인증 실패
 */

// 내 정보
app.get("/api/me", auth, (req, res) => {
	const user = users.find((u) => u.id === req.user.id);
	if (!user) return res.status(401).json({ error: "Not found" });
	res.json({
		id: user.id,
		email: user.email,
		role: user.role,
		profile: user.profile,
	});
});
/**
 * @swagger
 * /api/me:
 *   patch:
 *     summary: 내 프로필 수정
 *     description: JWT 인증 필요, 내 프로필 정보(이름, 소개, 이미지, 기술스택 등) 수정
 *     tags: [User]
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
 *                 properties:
 *                   name:
 *                     type: string
 *                   bio:
 *                     type: string
 *                   imageUrl:
 *                     type: string
 *                   skills:
 *                     type: array
 *                     items:
 *                       type: string
 *     responses:
 *       200:
 *         description: 프로필 수정 성공
 *       400:
 *         description: 잘못된 요청
 *       401:
 *         description: 인증 실패
 */

// 내 프로필 수정
app.patch("/api/me", auth, (req, res) => {
	const user = users.find((u) => u.id === req.user.id);
	if (!user) return res.status(401).json({ error: "Not found" });
	const { profile } = req.body;
	if (!profile) return res.status(400).json({ error: "Invalid payload" });
	if (profile.name !== undefined) user.profile.name = profile.name;
	if (profile.bio !== undefined) user.profile.bio = profile.bio;
	if (profile.imageUrl !== undefined) user.profile.imageUrl = profile.imageUrl;
	if (user.role === "mentor" && profile.skills !== undefined)
		user.profile.skills = profile.skills;
	res.json({ message: "Profile updated", profile: user.profile });
});
/**
 * @swagger
 * /api/mentors:
 *   get:
 *     summary: 멘토 전체 리스트 조회 (멘티 전용)
 *     description: |
 *       멘티가 멘토 리스트를 조회합니다. skill, order_by 쿼리 지원.<br>
 *       <b>쿼리 파라미터를 제공하지 않으면 전체 멘토 리스트를 반환합니다.</b>
 *     tags: [Mentor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: skill
 *         schema:
 *           type: string
 *         description: "한 가지 기술스택 키워드로 필터링 (예: react)"
 *       - in: query
 *         name: order_by
 *         schema:
 *           type: string
 *           enum: [name, skill]
 *         description: "정렬 기준 (name: 이름순, skill: 기술스택순)"
 *     responses:
 *       200:
 *         description: 멘토 리스트 반환 (쿼리 파라미터 없으면 전체 반환)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   email:
 *                     type: string
 *                   role:
 *                     type: string
 *                   profile:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       bio:
 *                         type: string
 *                       imageUrl:
 *                         type: string
 *                       skills:
 *                         type: array
 *                         items:
 *                           type: string
 *             examples:
 *               empty:
 *                 summary: 조회 결과 없음
 *                 value: []
 *               found:
 *                 summary: 조회 결과 있음
 *                 value:
 *                   - id: 3
 *                     email: user@example.com
 *                     role: mentor
 *                     profile:
 *                       name: 김앞단
 *                       bio: Frontend mentor
 *                       imageUrl: /images/mentor/3
 *                       skills: ["React", "Vue"]
 *                   - id: 4
 *                     email: user2@example.com
 *                     role: mentor
 *                     profile:
 *                       name: 이뒷단
 *                       bio: Backend mentor
 *                       imageUrl: /images/mentor/4
 *                       skills: ["Spring Boot", "FastAPI"]
 *       401:
 *         description: 인증 실패
 *       403:
 *         description: 권한 없음 (멘티가 아닐 때)
 *       500:
 *         description: 서버 에러
 */
/**
 * @swagger
 * /api/match-requests:
 *   post:
 *     summary: 매칭 요청 보내기 (멘티만)
 *     description: 멘티가 멘토에게 매칭 요청을 보냄
 *     tags: [Match]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mentorId
 *               - menteeId
 *               - message
 *             properties:
 *               mentorId:
 *                 type: integer
 *               menteeId:
 *                 type: integer
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: 매칭 요청 성공
 *       400:
 *         description: 잘못된 요청
 *       403:
 *         description: 권한 없음
 */

// 매칭 요청 보내기 (멘티만)
app.post("/api/match-requests", auth, (req, res) => {
	if (req.user.role !== "mentee")
		return res.status(403).json({ error: "Forbidden" });
	const { mentorId, menteeId, message } = req.body;
	if (!mentorId || !menteeId || !message)
		return res.status(400).json({ error: "Invalid payload" });
	const mentor = users.find((u) => u.id === mentorId && u.role === "mentor");
	if (!mentor) return res.status(400).json({ error: "Mentor not found" });
	const id = matchRequests.length + 1;
	matchRequests.push({ id, mentorId, menteeId, message, status: "pending" });
	res.json({ id, mentorId, menteeId, message, status: "pending" });
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

// 루트 접속 시 Swagger UI로 리다이렉트
app.get("/", (req, res) => {
	res.redirect("/api-docs");
});
// OpenAPI JSON 문서 제공
app.get("/openapi.json", (req, res) => {
	res.setHeader("Content-Type", "application/json");
	res.send(swaggerSpec);
});

app.listen(PORT, () => {
	console.log(`Server is running on http://localhost:${PORT}`);
});
