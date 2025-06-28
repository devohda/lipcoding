const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// DB 파일 경로 (로컬에 mentor-mentee.db 생성)
const dbPath = path.join(__dirname, "mentor-mentee.db");
const db = new sqlite3.Database(dbPath);

// 테이블 생성 (최초 1회만 실행됨)
db.serialize(() => {
	db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    bio TEXT,
    imageUrl TEXT,
    skills TEXT
  )`);

	db.run(`CREATE TABLE IF NOT EXISTS match_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mentorId INTEGER NOT NULL,
    menteeId INTEGER NOT NULL,
    message TEXT,
    status TEXT DEFAULT 'pending',
    FOREIGN KEY (mentorId) REFERENCES users(id),
    FOREIGN KEY (menteeId) REFERENCES users(id)
  )`);
});

module.exports = db;
