import { GraphQLError } from 'graphql';
import { createServer } from 'http';
import { startStandaloneServer } from '@apollo/server/standalone';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { makeExecutableSchema } from '@graphql-tools/schema';
import WebSocket from 'ws';  // Importación por defecto de 'ws'
import { useServer } from 'graphql-ws/lib/use/ws';

import express from 'express';
import http from 'http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { PubSub } from 'graphql-subscriptions';

import cors from 'cors';

// Importar modelos
import Author from './models/Author.js';
import Book from './models/Book.js';
import User from './models/User.js';
import Person from './models/Person.js'; 

const pubsub = new PubSub();
const JWT_SECRET = 'SECRET_KEY';
const app = express();
app.use(express.json());

// Crear servidor HTTP
const httpServer = createServer(app);

// Configuración de CORS
const corsOptions = {
  origin: 'https://jaoreactgraphqlfront.onrender.com',
  credentials: true,
};
app.use(cors(corsOptions));

// Conexión a MongoDB
mongoose.connect('mongodb+srv://jaoprogramador:QuJDcyCyEDGquupK@graphql-library.hjxot.mongodb.net/?retryWrites=true&w=majority&appName=graphql-library', {})
  .then(() => console.log('Conectado a MongoDB'))
  .catch(err => console.log('Error de conexión:', err));

// Definir esquema y resolvers

const typeDefs = `
  type User {
    username: String!
    favoriteGenre: String!
    id: ID!
  }

  type Token {
    value: String!
  }

  type Author {
    id: ID!
    name: String!
    born: Int
    bookCount: Int!
  }

  type Book {
    id: ID!
    title: String!
    published: Int!
    author: Author!
    genres: [String!]!
  }

  input AuthorInput { 
    name: String!
  }

  type Query {
    personCount: Int!
    allPersons: [Person!]!
    findPerson(name: String!): Person
    allBooks(genre: String): [Book!]!
    allAuthors: [Author!]!
    me: User
  }

  type Person {
    name: String!
    phone: String
    address: Address!
    id: ID!
  }

  type Address {
    street: String!
    city: String!
  }

  type Mutation {
    addPerson(
      name: String!
      phone: String
      street: String!
      city: String!
    ): Person

    editNumber(
      name: String!
      phone: String!
    ): Person

    addBook(
      title: String!, 
      author: AuthorInput!, 
      published: Int!, 
      genres: [String!]!
    ): Book!

    updateAuthor(
      name: String!, 
      born: Int!
    ): Author

    createUser(
      username: String!
      favoriteGenre: String!
      password: String!     
    ): User

    login(
      username: String!
      password: String!
    ): Token
    
  }

  type Subscription {
    bookAdded: Book!
  }
`;

const BOOK_ADDED = 'BOOK_ADDED';

const resolvers = {
  Query: {
    personCount: async () => await Person.countDocuments(),
    allPersons: async (root, args) => {
      if (!args.phone) {
        return await Person.find({});
      }
      const byPhone = args.phone === 'YES' ? { phone: { $exists: true } } : { phone: { $exists: false } };
      return await Person.find(byPhone);
    },
    findPerson: async (root, args) => await Person.findOne({ name: args.name }),
    allBooks: async (root, { genre }) => {
      console.log('Resolvers:::allBooks-genre', genre);
      const filter = genre ? { genres: genre } : {};
      console.log('Resolvers:::allBooks filter', filter);
      return await Book.find(filter).populate('author');
    },
    allAuthors: async () => {
      return await Author.find();
    },
    me: (root, args, context) => {
      console.log('Resolvers:::me-context', context.currentUser);
      if (!context.currentUser) {
        return null; // Usuario no autenticado
      }
      return context.currentUser;
    },
  },

  Mutation: {
    createUser: async (root, args) => {
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(args.password, saltRounds);
      const user = new User({
        username: args.username,
        favoriteGenre: args.favoriteGenre,
        passwordHash,
      });
      try {
        return await user.save();
      } catch (error) {
        throw new GraphQLError('Error al crear usuario', {
          extensions: { code: 'BAD_USER_INPUT', error },
        });
      }
    },

    login: async (root, { username, password }) => {
      const user = await User.findOne({ username });
      const passwordCorrect = user === null ? false : await bcrypt.compare(password, user.passwordHash);
      if (!(user && passwordCorrect)) {
        throw new GraphQLError('Credenciales incorrectas', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      const userForToken = { username: user.username, id: user._id };
      return { value: jwt.sign(userForToken, JWT_SECRET) };
    },

    addPerson: async (root, args) => {
      const existingPerson = await Person.findOne({ name: args.name });
      if (existingPerson) {
        throw new GraphQLError('Name must be unique', {
          extensions: { code: 'BAD_USER_INPUT', invalidArgs: args.name },
        });
      }
      const person = new Person({
        name: args.name,
        phone: args.phone,
        address: { street: args.street, city: args.city },
      });
      await person.save();
      return person;
    },

    editNumber: async (root, args) => {
      const person = await Person.findOne({ name: args.name });
      if (!person) return null;
      person.phone = args.phone;
      await person.save();
      return person;
    },

    addBook: async (root, args, context) => {
      const { title, published, genres } = args;
      const authorName = args.author.name;
      if (!context.currentUser) {
        throw new GraphQLError('No autorizado', { extensions: { code: 'UNAUTHORIZED' } });
      }
      if (title.length < 3) {
        throw new GraphQLError('El título del libro debe tener al menos 3 caracteres.', {
          extensions: { code: 'BAD_USER_INPUT', invalidArgs: title },
        });
      }
      const currentYear = new Date().getFullYear();
      if (published > currentYear) {
        throw new GraphQLError('El año de publicación no puede ser mayor que el año actual.', {
          extensions: { code: 'BAD_USER_INPUT', invalidArgs: published },
        });
      }
      if (!genres || genres.length === 0) {
        throw new GraphQLError('El libro debe tener al menos un género.', {
          extensions: { code: 'BAD_USER_INPUT', invalidArgs: genres },
        });
      }
      let author = await Author.findOne({ name: authorName });
      if (!author) {
        author = new Author({ name: authorName, bookCount: 0 });
        await author.save();
      }
      const book = new Book({ title, published, author: author._id, genres });
      await book.save();

      pubsub.publish(BOOK_ADDED, { bookAdded: book });

      author.bookCount += 1;
      await author.save();
      return await Book.findById(book._id).populate('author');
    },

    updateAuthor: async (_, { name, born }) => {
      if (name.length < 3) {
        throw new GraphQLError('El nombre del autor debe tener al menos 3 caracteres.', {
          extensions: { code: 'BAD_USER_INPUT', invalidArgs: name },
        });
      }
      const currentYear = new Date().getFullYear();
      if (born > currentYear) {
        throw new GraphQLError('El año de nacimiento no puede ser mayor que el año actual.', {
          extensions: { code: 'BAD_USER_INPUT', invalidArgs: born },
        });
      }
      const author = await Author.findOne({ name });
      if (!author) {
        throw new GraphQLError('Autor no encontrado', {
          extensions: { code: 'BAD_USER_INPUT', invalidArgs: name },
        });
      }
      author.born = born;
      await author.save();
      return author;
    },
  },

  Subscription: {
    bookAdded: {
      subscribe: () => pubsub.asyncIterator([BOOK_ADDED]),
    },
  },
};

// Configura el ApolloServer
const server = new ApolloServer({
  schema: makeExecutableSchema({ typeDefs, resolvers }),
  csrfPrevention: false,
  context: ({ req }) => {
    const token = req.headers.authorization || '';
    if (token) {
      try {
        const decodedToken = jwt.verify(token.split(' ')[1], JWT_SECRET);
        return { currentUser: decodedToken };
      } catch (err) {
        console.error(err);
        throw new Error('Authentication failed');
      }
    }
    return {};
  },
});

// Configura WebSocketLink para las suscripciones
const wsServer = new WebSocket.Server({
  server: httpServer,
  path: '/graphql',
});

// Usa graphql-ws para las conexiones de WebSocket
useServer({
  schema: makeExecutableSchema({ typeDefs, resolvers }),
  onConnect: async (context) => {
    const token = context.connectionParams.authorization;
    if (token && token.startsWith('Bearer ')) {
      const decodedToken = jwt.verify(token.substring(7), JWT_SECRET);
      const currentUser = await User.findById(decodedToken.id);
      if (!currentUser) {
        throw new Error('Authentication failed!');
      }
      return { currentUser };
    }
    throw new Error('No Authorization header provided!');
  },
}, wsServer);

// Iniciar el servidor Apollo
await server.start();

// Aplicar el middleware de Apollo Server a Express
app.use('/graphql', expressMiddleware(server));


// Inicia el servidor HTTP
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server ready at http://localhost:${PORT}/graphql`);
});