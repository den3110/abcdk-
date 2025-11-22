// graphql/index.js
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@as-integrations/express4";
import { ApolloServerPluginLandingPageLocalDefault } from "@apollo/server/plugin/landingPage/default";

import { coreTypeDefs } from "./coreTypeDefs.js";
import { userTypeDefs } from "./modules/user/typeDefs.js";
import { userResolvers } from "./modules/user/resolvers.js";
import { buildContext } from "./context.js";

export async function setupGraphQL(app) {
  const typeDefs = [
    coreTypeDefs,
    userTypeDefs
    // sau này thêm: tournamentTypeDefs, matchTypeDefs, ...
  ];

  const resolvers = [
    userResolvers
    // sau này thêm: tournamentResolvers, matchResolvers, ...
  ];

  const server = new ApolloServer({
    typeDefs,
    resolvers,
    plugins: [ApolloServerPluginLandingPageLocalDefault({
        // 👇 RẤT QUAN TRỌNG: cho Sandbox gửi cookie kèm mỗi request
        includeCookies: true,
      })],
    formatError(formattedError) {
      // ở đây có thể chuẩn hoá error theo kiểu công ty lớn
      // ví dụ map mã lỗi, ghi log, v.v.
      return formattedError;
    }
  });

  await server.start();

  app.use(
    "/graphql",
    // express.json() đã được dùng ở server.js, nên không cần bodyParser ở đây nữa
    expressMiddleware(server, {
      context: buildContext
    })
  );

  console.log("✅ GraphQL endpoint mounted at /graphql");
}
