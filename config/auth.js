import jwt from "jsonwebtoken";

export const createAccessToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "15m"
  });
};

export const setAuthCookie = (res, token) => {
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie(process.env.COOKIE_NAME || "accessToken", token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/"
    // Session cookie (no maxAge) so browser close clears it.
  });
};

export const clearAuthCookie = (res) => {
  const isProduction = process.env.NODE_ENV === "production";
  res.clearCookie(process.env.COOKIE_NAME || "accessToken", {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/"
  });
};
