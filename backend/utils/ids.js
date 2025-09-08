// src/utils/ids.js
import mongoose from "mongoose";
export const asId = (x) => new mongoose.Types.ObjectId(String(x));
export const isId = (x) => mongoose.Types.ObjectId.isValid(String(x));
