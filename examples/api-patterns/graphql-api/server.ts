/**
 * GraphQL API with GraphQL Yoga + Express
 *
 * A complete, runnable GraphQL server with User and Product types,
 * queries with filtering, mutations with input validation, and an
 * in-memory data store. Demonstrates schema-first design, resolver
 * patterns, and proper error handling via GraphQL errors.
 *
 * Run: npx tsx server.ts
 * Test: curl http://localhost:4000/graphql -X POST \
 *         -H "Content-Type: application/json" \
 *         -d '{"query":"{ users { id name email } }"}'
 *
 * GraphiQL playground available at http://localhost:4000/graphql
 */

import express from "express";
import { createSchema, createYoga } from "graphql-yoga";
import { GraphQLError } from "graphql";

// =============================================================================
// Types
// =============================================================================

interface User {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  createdAt: string;
}

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  inStock: boolean;
  createdBy: string;
  createdAt: string;
}

// =============================================================================
// In-Memory Store
// =============================================================================

/** Simple incrementing ID generator (good enough for demo purposes). */
let nextId = 1;
function generateId(): string {
  return String(nextId++);
}

const users: User[] = [
  { id: generateId(), name: "Alice Johnson", email: "alice@example.com", role: "admin", createdAt: new Date(Date.now() - 86400000 * 5).toISOString() },
  { id: generateId(), name: "Bob Smith", email: "bob@example.com", role: "user", createdAt: new Date(Date.now() - 86400000 * 3).toISOString() },
  { id: generateId(), name: "Carol Davis", email: "carol@example.com", role: "user", createdAt: new Date(Date.now() - 86400000).toISOString() },
];

const products: Product[] = [
  { id: generateId(), name: "Mechanical Keyboard", description: "Cherry MX Brown switches, hot-swappable", price: 129.99, category: "electronics", inStock: true, createdBy: "1", createdAt: new Date(Date.now() - 86400000 * 2).toISOString() },
  { id: generateId(), name: "Ergonomic Mouse", description: "Vertical design, 6 buttons, wireless", price: 59.99, category: "electronics", inStock: true, createdBy: "1", createdAt: new Date(Date.now() - 86400000).toISOString() },
  { id: generateId(), name: "Standing Desk Mat", description: "Anti-fatigue mat, 20x34 inches", price: 44.99, category: "furniture", inStock: false, createdBy: "2", createdAt: new Date().toISOString() },
];

// =============================================================================
// Validation Helpers
// =============================================================================

/** Validate an email address format. */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Throw a GraphQL error with a specific error code.
 * GraphQL Yoga surfaces these as structured errors in the response,
 * which is the GraphQL-idiomatic way to communicate failures.
 */
function validationError(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "VALIDATION_ERROR" },
  });
}

function notFoundError(resource: string, id: string): GraphQLError {
  return new GraphQLError(`${resource} with id "${id}" not found`, {
    extensions: { code: "NOT_FOUND" },
  });
}

// =============================================================================
// GraphQL Schema (SDL)
// =============================================================================

/**
 * Schema-first approach: the type definitions are written in SDL and
 * resolvers are wired separately. This keeps the schema readable and
 * makes it easy to share with frontend teams.
 */
const typeDefs = /* GraphQL */ `
  type User {
    id: ID!
    name: String!
    email: String!
    role: String!
    createdAt: String!
    products: [Product!]!
  }

  type Product {
    id: ID!
    name: String!
    description: String!
    price: Float!
    category: String!
    inStock: Boolean!
    createdBy: User
    createdAt: String!
  }

  type Query {
    """Fetch a single user by ID."""
    user(id: ID!): User

    """List all users, optionally filtered by role."""
    users(role: String): [User!]!

    """Fetch a single product by ID."""
    product(id: ID!): Product

    """
    List products with optional filters.
    - category: filter by product category
    - inStock: filter by availability
    - minPrice / maxPrice: filter by price range
    """
    products(
      category: String
      inStock: Boolean
      minPrice: Float
      maxPrice: Float
    ): [Product!]!
  }

  input CreateUserInput {
    name: String!
    email: String!
    role: String
  }

  input UpdateUserInput {
    name: String
    email: String
    role: String
  }

  input CreateProductInput {
    name: String!
    description: String!
    price: Float!
    category: String!
    inStock: Boolean
    createdBy: ID!
  }

  input UpdateProductInput {
    name: String
    description: String
    price: Float
    category: String
    inStock: Boolean
  }

  type DeleteResult {
    success: Boolean!
    message: String!
  }

  type Mutation {
    """Create a new user. Email must be unique and valid."""
    createUser(input: CreateUserInput!): User!

    """Update an existing user. Only provided fields are changed."""
    updateUser(id: ID!, input: UpdateUserInput!): User!

    """Delete a user by ID. Also removes their products."""
    deleteUser(id: ID!): DeleteResult!

    """Create a new product. createdBy must reference an existing user."""
    createProduct(input: CreateProductInput!): Product!

    """Update an existing product. Only provided fields are changed."""
    updateProduct(id: ID!, input: UpdateProductInput!): Product!

    """Delete a product by ID."""
    deleteProduct(id: ID!): DeleteResult!
  }
`;

// =============================================================================
// Resolvers
// =============================================================================

const resolvers = {
  // ---------------------------------------------------------------------------
  // Query Resolvers
  // ---------------------------------------------------------------------------

  Query: {
    /** Fetch a single user by ID. Returns null if not found. */
    user: (_: unknown, args: { id: string }) => {
      return users.find((u) => u.id === args.id) ?? null;
    },

    /** List users, optionally filtered by role. */
    users: (_: unknown, args: { role?: string }) => {
      if (args.role) {
        return users.filter((u) => u.role === args.role);
      }
      return users;
    },

    /** Fetch a single product by ID. Returns null if not found. */
    product: (_: unknown, args: { id: string }) => {
      return products.find((p) => p.id === args.id) ?? null;
    },

    /**
     * List products with optional filters.
     * Filters are combined with AND logic — all specified conditions must match.
     */
    products: (_: unknown, args: { category?: string; inStock?: boolean; minPrice?: number; maxPrice?: number }) => {
      let result = products;

      if (args.category) {
        result = result.filter((p) => p.category === args.category);
      }
      if (args.inStock !== undefined) {
        result = result.filter((p) => p.inStock === args.inStock);
      }
      if (args.minPrice !== undefined) {
        result = result.filter((p) => p.price >= args.minPrice!);
      }
      if (args.maxPrice !== undefined) {
        result = result.filter((p) => p.price <= args.maxPrice!);
      }

      return result;
    },
  },

  // ---------------------------------------------------------------------------
  // Field Resolvers
  // ---------------------------------------------------------------------------

  /** Resolve the products field on User by filtering the products store. */
  User: {
    products: (parent: User) => {
      return products.filter((p) => p.createdBy === parent.id);
    },
  },

  /** Resolve the createdBy field on Product by looking up the user. */
  Product: {
    createdBy: (parent: Product) => {
      return users.find((u) => u.id === parent.createdBy) ?? null;
    },
  },

  // ---------------------------------------------------------------------------
  // Mutation Resolvers
  // ---------------------------------------------------------------------------

  Mutation: {
    /** Create a new user with validation: name required, email unique and valid. */
    createUser: (_: unknown, args: { input: { name: string; email: string; role?: string } }) => {
      const { name, email, role } = args.input;

      // Validate name
      if (!name || name.trim().length === 0) {
        throw validationError("Name is required and cannot be empty");
      }
      if (name.length > 100) {
        throw validationError("Name must be 100 characters or fewer");
      }

      // Validate email format
      if (!isValidEmail(email)) {
        throw validationError("Invalid email address format");
      }

      // Validate email uniqueness
      if (users.find((u) => u.email === email)) {
        throw validationError(`A user with email "${email}" already exists`);
      }

      // Validate role if provided
      if (role && !["user", "admin"].includes(role)) {
        throw validationError('Role must be "user" or "admin"');
      }

      const user: User = {
        id: generateId(),
        name: name.trim(),
        email: email.toLowerCase().trim(),
        role: (role as User["role"]) ?? "user",
        createdAt: new Date().toISOString(),
      };

      users.push(user);
      return user;
    },

    /** Update an existing user. Validates changed fields the same as createUser. */
    updateUser: (_: unknown, args: { id: string; input: { name?: string; email?: string; role?: string } }) => {
      const index = users.findIndex((u) => u.id === args.id);
      if (index === -1) {
        throw notFoundError("User", args.id);
      }

      const { name, email, role } = args.input;

      if (name !== undefined) {
        if (name.trim().length === 0) {
          throw validationError("Name cannot be empty");
        }
        if (name.length > 100) {
          throw validationError("Name must be 100 characters or fewer");
        }
        users[index].name = name.trim();
      }

      if (email !== undefined) {
        if (!isValidEmail(email)) {
          throw validationError("Invalid email address format");
        }
        // Uniqueness check — exclude the current user
        if (users.find((u) => u.email === email && u.id !== args.id)) {
          throw validationError(`A user with email "${email}" already exists`);
        }
        users[index].email = email.toLowerCase().trim();
      }

      if (role !== undefined) {
        if (!["user", "admin"].includes(role)) {
          throw validationError('Role must be "user" or "admin"');
        }
        users[index].role = role as User["role"];
      }

      return users[index];
    },

    /** Delete a user and cascade-remove their products. */
    deleteUser: (_: unknown, args: { id: string }) => {
      const index = users.findIndex((u) => u.id === args.id);
      if (index === -1) {
        throw notFoundError("User", args.id);
      }

      // Remove products created by this user
      const removedProducts = products.filter((p) => p.createdBy === args.id);
      for (const p of removedProducts) {
        const pIndex = products.indexOf(p);
        if (pIndex !== -1) products.splice(pIndex, 1);
      }

      users.splice(index, 1);
      return {
        success: true,
        message: `User deleted along with ${removedProducts.length} product(s)`,
      };
    },

    /** Create a new product. Validates required fields and createdBy reference. */
    createProduct: (_: unknown, args: { input: { name: string; description: string; price: number; category: string; inStock?: boolean; createdBy: string } }) => {
      const { name, description, price, category, inStock, createdBy } = args.input;

      if (!name || name.trim().length === 0) {
        throw validationError("Product name is required");
      }
      if (name.length > 200) {
        throw validationError("Product name must be 200 characters or fewer");
      }
      if (price < 0) {
        throw validationError("Price must be zero or positive");
      }
      if (!category || category.trim().length === 0) {
        throw validationError("Category is required");
      }
      if (!users.find((u) => u.id === createdBy)) {
        throw notFoundError("User (createdBy)", createdBy);
      }

      const product: Product = {
        id: generateId(),
        name: name.trim(),
        description: description?.trim() ?? "",
        price,
        category: category.toLowerCase().trim(),
        inStock: inStock ?? true,
        createdBy,
        createdAt: new Date().toISOString(),
      };

      products.push(product);
      return product;
    },

    /** Update an existing product. Only provided fields are changed. */
    updateProduct: (_: unknown, args: { id: string; input: { name?: string; description?: string; price?: number; category?: string; inStock?: boolean } }) => {
      const index = products.findIndex((p) => p.id === args.id);
      if (index === -1) {
        throw notFoundError("Product", args.id);
      }

      const { name, description, price, category, inStock } = args.input;

      if (name !== undefined) {
        if (name.trim().length === 0) {
          throw validationError("Product name cannot be empty");
        }
        if (name.length > 200) {
          throw validationError("Product name must be 200 characters or fewer");
        }
        products[index].name = name.trim();
      }
      if (description !== undefined) {
        products[index].description = description.trim();
      }
      if (price !== undefined) {
        if (price < 0) {
          throw validationError("Price must be zero or positive");
        }
        products[index].price = price;
      }
      if (category !== undefined) {
        if (category.trim().length === 0) {
          throw validationError("Category cannot be empty");
        }
        products[index].category = category.toLowerCase().trim();
      }
      if (inStock !== undefined) {
        products[index].inStock = inStock;
      }

      return products[index];
    },

    /** Delete a product by ID. */
    deleteProduct: (_: unknown, args: { id: string }) => {
      const index = products.findIndex((p) => p.id === args.id);
      if (index === -1) {
        throw notFoundError("Product", args.id);
      }

      products.splice(index, 1);
      return { success: true, message: "Product deleted" };
    },
  },
};

// =============================================================================
// Server Setup
// =============================================================================

const app = express();

/**
 * GraphQL Yoga provides a fully-featured GraphQL server that handles
 * query parsing, validation, execution, and error formatting.
 * The built-in GraphiQL IDE is served at the same endpoint for browser requests.
 */
const yoga = createYoga({
  schema: createSchema({ typeDefs, resolvers }),
  graphqlEndpoint: "/graphql",
});

// Mount Yoga as Express middleware on the /graphql path
app.use("/graphql", yoga);

// ---------------------------------------------------------------------------
// Health check (plain REST — useful for load balancers and k8s probes)
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// =============================================================================
// Start
// =============================================================================

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`GraphQL API running at http://localhost:${PORT}/graphql`);
  console.log();
  console.log(`Open http://localhost:${PORT}/graphql in a browser for GraphiQL`);
  console.log();
  console.log("Example queries:");
  console.log(`  curl http://localhost:${PORT}/graphql -X POST \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{"query":"{ users { id name email role products { name price } } }"}'`);
  console.log();
  console.log(`  curl http://localhost:${PORT}/graphql -X POST \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{"query":"{ products(category: \\"electronics\\", inStock: true) { name price } }"}'`);
  console.log();
  console.log(`  curl http://localhost:${PORT}/graphql -X POST \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{"query":"mutation { createUser(input: { name: \\"Dan\\", email: \\"dan@example.com\\" }) { id name } }"}'`);
});
