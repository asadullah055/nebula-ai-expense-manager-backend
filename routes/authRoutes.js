import express from "express";
import { body } from "express-validator";
import passport from "passport";
import {
  getMe,
  googleCallback,
  googleTokenLogin,
  login,
  logout,
  signup,
  updateProfile
} from "../controllers/authController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

router.post(
  "/signup",
  [
    body("name").trim().isLength({ min: 2 }).withMessage("Name must be at least 2 characters"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters")
      .matches(/^(?=.*[A-Za-z])(?=.*\d).+$/)
      .withMessage("Password must contain letters and numbers")
  ],
  signup
);

router.post(
  "/login",
  [
    body("email").isEmail().withMessage("Valid email is required"),
    body("password").notEmpty().withMessage("Password is required")
  ],
  login
);

router.post(
  "/google/token",
  [body("credential").notEmpty().withMessage("Google credential is required")],
  googleTokenLogin
);

router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false
  })
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/api/auth/google/failure",
    session: false
  }),
  googleCallback
);

router.get("/google/failure", (_req, res) => {
  return res.status(401).json({ message: "Google authentication failed" });
});

router.get("/me", authMiddleware, getMe);
router.patch(
  "/profile",
  authMiddleware,
  [
    body("name")
      .optional()
      .isString()
      .withMessage("Name must be a string")
      .trim()
      .isLength({ min: 2, max: 60 })
      .withMessage("Name must be between 2 and 60 characters"),
    body("companyDescription")
      .optional()
      .isString()
      .withMessage("Company description must be a string")
      .isLength({ max: 500 })
      .withMessage("Company description must be at most 500 characters"),
    body("avatar")
      .optional({ nullable: true })
      .custom((value) => value === null || typeof value === "string")
      .withMessage("Avatar must be a string or null")
  ],
  updateProfile
);
router.post("/logout", logout);
router.get("/logout", logout);

export default router;
