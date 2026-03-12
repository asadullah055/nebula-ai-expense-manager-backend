import jwt from "jsonwebtoken";

const authMiddleware = (req, res, next) => {
  const cookieName = process.env.COOKIE_NAME || "accessToken";
  const token = req.cookies[cookieName];

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    return next();
  } catch (_error) {
    return res.status(401).json({ message: "Token is invalid or expired" });
  }
};

export default authMiddleware;