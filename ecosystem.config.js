module.exports = {
  apps: [
    {
      name: "abcdk-api", // tên app trong PM2
      cwd: "/abcdk-/backend", // thư mục chạy trên VPS (đúng theo bạn)
      script: "./dist/server.js", // đổi nếu entry khác: ví dụ ./server.js hoặc ./build/index.js
      instances: "max",
      exec_mode: "cluster",
      env: { NODE_ENV: "production" },
    },
  ],
};
