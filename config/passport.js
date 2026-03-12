import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import User from "../models/User.js";

const configurePassport = () => {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const photoUrl = profile.photos?.[0]?.value || null;
          let user = await User.findOne({ googleId: profile.id });

          if (!user) {
            // If email already exists from local signup, attach googleId to same account.
            user = await User.findOne({ email: profile.emails?.[0]?.value?.toLowerCase() });
          }

          if (!user) {
            user = await User.create({
              name: profile.displayName,
              email: profile.emails?.[0]?.value?.toLowerCase(),
              googleId: profile.id,
              avatar: photoUrl,
              provider: "google"
            });
          } else if (!user.googleId) {
            user.googleId = profile.id;
            user.provider = "google";
            if (photoUrl && !user.avatar) {
              user.avatar = photoUrl;
            }
            await user.save();
          } else if (photoUrl && user.avatar !== photoUrl) {
            user.avatar = photoUrl;
            await user.save();
          }

          done(null, user);
        } catch (error) {
          done(error, null);
        }
      }
    )
  );
};

export default configurePassport;
