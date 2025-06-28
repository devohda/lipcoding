const express = require("express");
const path = require("path");
const app = express();
const PORT = 3000;

// 정적 파일 제공 (index.html, css 등)
app.use(express.static(path.join(__dirname, ".")));

app.get("/", (req, res) => {
	res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
	console.log(`Frontend static server running at http://localhost:${PORT}`);
});
