const express = require("express");
const path = require("path");
const app = express();
const PORT = 3000;

// 정적 파일 제공 (index.html, css 등)
app.use(express.static(path.join(__dirname, ".")));

app.get("/", (req, res) => {
	res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/mentors", (req, res) => {
	res.sendFile(path.join(__dirname, "mentors.html"));
});

app.get("/signup", (req, res) => {
	res.sendFile(path.join(__dirname, "signup.html"));
});

app.get("/login", (req, res) => {
	res.sendFile(path.join(__dirname, "login.html"));
});

app.get("/profile", (req, res) => {
	res.sendFile(path.join(__dirname, "profile.html"));
});

app.get("/requests-incoming", (req, res) => {
	res.sendFile(path.join(__dirname, "requests-incoming.html"));
});

app.get("/main", (req, res) => {
	res.sendFile(path.join(__dirname, "main.html"));
});

// 404 핸들러 (선택)
app.use((req, res) => {
	res.status(404).send("Not Found");
});

app.listen(PORT, () => {
	console.log(`Frontend static server running at http://localhost:${PORT}`);
});
