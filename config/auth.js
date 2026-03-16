import jwt from "jsonwebtoken";

export const createAccessToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "15m"
  });
};

const getCookieBaseOptions = () => {
  const isProduction = process.env.NODE_ENV === "production";
  const domain = (process.env.COOKIE_DOMAIN || "").trim();

  return {
    isProduction,
    options: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      path: "/",
      ...(domain ? { domain } : {})
    }
  };
};

export const setAuthCookie = (res, token) => {
  const { options } = getCookieBaseOptions();
  res.cookie(process.env.COOKIE_NAME || "accessToken", token, options);
};

export const clearAuthCookie = (res) => {
  const cookieName = process.env.COOKIE_NAME || "accessToken";
  const { options } = getCookieBaseOptions();

  // Primary clear path (same options used during set).
  res.clearCookie(cookieName, options);

  // Defensive clears for deployments with mismatched secure/sameSite/domain settings.
  const domain = (process.env.COOKIE_DOMAIN || "").trim();
  const clearVariants = [
    { httpOnly: true, secure: true, sameSite: "none", path: "/" },
    { httpOnly: true, secure: false, sameSite: "lax", path: "/" },
    { httpOnly: true, secure: false, sameSite: "none", path: "/" },
    { httpOnly: true, secure: true, sameSite: "lax", path: "/" }
  ];

  for (const variant of clearVariants) {
    res.clearCookie(cookieName, variant);
    if (domain) {
      res.clearCookie(cookieName, { ...variant, domain });
    }
  }
};
