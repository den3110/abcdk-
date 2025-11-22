// graphql/loaders/index.js
import { createUserLoader } from "./userLoader.js";

export function createLoaders() {
  return {
    userById: createUserLoader(),
    // sau này thêm: tournamentById, matchById, ...
  };
}
