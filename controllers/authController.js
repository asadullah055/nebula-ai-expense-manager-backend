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
      provider: user.provider
    }
  });
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
