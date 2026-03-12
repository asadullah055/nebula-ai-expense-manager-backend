import jwt from "jsonwebtoken";

export const createAccessToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "15m"
  });
};

export const setAuthCookie = (res, token) => {
  res.cookie(process.env.COOKIE_NAME || "accessToken", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax"
    // Session cookie (no maxAge) so browser close clears it.
  });
};

export const clearAuthCookie = (res) => {
  res.clearCookie(process.env.COOKIE_NAME || "accessToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax"
  });
};