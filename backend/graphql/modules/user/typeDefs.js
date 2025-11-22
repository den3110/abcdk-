// graphql/modules/user/typeDefs.js
export const userTypeDefs = `#graphql
  extend type Query {
    me: User
    user(id: ID!): User
    users(limit: Int = 20, offset: Int = 0): [User!]!
  }

  extend type Mutation {
    register(input: CreateUserInput!): User!
  }

  type User {
    id: ID!
    name: String
    nickname: String
    phone: String
    email: String
    role: String!
    isAdmin: Boolean!
    avatar: String
    cover: String
    province: String
    verified: String
    cccdStatus: String
    createdAt: String
    updatedAt: String
  }

  input CreateUserInput {
    name: String!
    nickname: String!
    email: String
    phone: String
    password: String!
    role: String
  }
`;
