import bcrypt from "bcryptjs";
import { validationResult } from "express-validator";
import { OAuth2Client } from "google-auth-library";
import User from "../models/User.js";
import { createAccessToken, setAuthCookie, clearAuthCookie } from "../config/auth.js";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const sendAuthResponse = (res, user) => {
  const token = createAccessToken(user._id.toString());
  setAuthCookie(res, token);

  return res.status(200).json({
    message: "Authentication successful",
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      provider: user.provider,
      companyDescription: user.companyDescription || ""
    }
  });
};

const sanitizeAvatar = (value) => {
  if (typeof value !== "string") {
    throw new Error("Avatar must be a string");
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed)) {
    if (trimmed.length > 2_500_000) {
      throw new Error("Avatar image is too large");
    }
    return trimmed;
  }

  if (/^(https?:)?\/\/\S+$/i.test(trimmed)) {
    return trimmed;
  }

  throw new Error("Avatar must be a valid image URL or base64 image");
};

export const signup = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, email, password } = req.body;

  try {
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ message: "Email already in use" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      provider: "local"
    });

    return sendAuthResponse(res, user);
  } catch (error) {
    return res.status(500).json({ message: "Signup failed", error: error.message });
  }
};

export const login = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !user.password) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    return sendAuthResponse(res, user);
  } catch (error) {
    return res.status(500).json({ message: "Login failed", error: error.message });
  }
};

export const googleCallback = async (req, res) => {
  const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
  const successRedirect = frontendUrl ? `${frontendUrl}/oauth-success` : "/oauth-success";
  const failureRedirect = frontendUrl
    ? `${frontendUrl}/login?error=google_auth_failed`
    : "/login?error=google_auth_failed";

  try {
    const token = createAccessToken(req.user._id.toString());
    setAuthCookie(res, token);

    // Frontend reads this route only once to set in-memory auth state.
    return res.redirect(successRedirect);
  } catch (error) {
    return res.redirect(failureRedirect);
  }
};

export const googleTokenLogin = async (req, res) => {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ message: "Google credential is required" });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const email = payload?.email?.toLowerCase();
    const googleId = payload?.sub;
    const name = payload?.name || "Google User";
    const avatar = payload?.picture || null;

    if (!email || !googleId) {
      return res.status(401).json({ message: "Invalid Google token payload" });
    }

    let user = await User.findOne({ googleId });

    if (!user) {
      user = await User.findOne({ email });
    }

    if (!user) {
      user = await User.create({
        name,
        email,
        googleId,
        avatar,
        provider: "google"
      });
    } else {
      let changed = false;
      if (!user.googleId) {
        user.googleId = googleId;
        changed = true;
      }
      if (user.provider !== "google") {
        user.provider = "google";
        changed = true;
      }
      if (avatar && user.avatar !== avatar) {
        user.avatar = avatar;
        changed = true;
      }
      if (name && user.name !== name) {
        user.name = name;
        changed = true;
      }
      if (changed) {
        await user.save();
      }
    }

    return sendAuthResponse(res, user);
  } catch (error) {
    return res.status(401).json({ message: "Google token verification failed", error: error.message });
  }
};

export const logout = (req, res) => {
  clearAuthCookie(res);
  return res.status(200).json({ message: "Logged out" });
};

export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({ user });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch profile", error: error.message });
  }
};

export const updateProfile = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, avatar, companyDescription } = req.body;

  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (typeof name === "string") {
      const trimmedName = name.trim();
      if (trimmedName.length < 2 || trimmedName.length > 60) {
        return res.status(400).json({ message: "Name must be between 2 and 60 characters" });
      }
      user.name = trimmedName;
    }

    if (avatar !== undefined) {
      if (avatar === null || (typeof avatar === "string" && !avatar.trim())) {
        user.avatar = null;
      } else {
        user.avatar = sanitizeAvatar(avatar);
      }
    }

    if (typeof companyDescription === "string") {
      user.companyDescription = companyDescription.trim();
    }

    await user.save();

    return res.status(200).json({
      message: "Profile updated",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        provider: user.provider,
        companyDescription: user.companyDescription || ""
      }
    });
  } catch (error) {
    const status = error.message === "Avatar image is too large" ? 413 : 400;
    if (
      error.message === "Avatar image is too large" ||
      error.message === "Avatar must be a valid image URL or base64 image" ||
      error.message === "Avatar must be a string"
    ) {
      return res.status(status).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to update profile", error: error.message });
  }
};
