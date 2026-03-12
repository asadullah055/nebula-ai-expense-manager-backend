import mongoose from "mongoose";

let isConnected = false;
let connectPromise = null;

const connectDB = async () => {
  if (isConnected) return;
  if (connectPromise) {
    await connectPromise;
    return;
  }

  try {
    connectPromise = mongoose.connect(process.env.MONGO_URI);
    await connectPromise;
    isConnected = true;
    console.log("MongoDB connected");
  } catch (error) {
    console.error("MongoDB connection error:", error.message);
    connectPromise = null;
    throw error;
  }
};

export default connectDB;
