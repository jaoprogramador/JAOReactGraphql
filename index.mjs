const JWT_SECRET = 'SECRET_KEY';
//VERSION SIN ERRORES EN DEPLOY PERO SIN PERMITIR LOGG
//const { GraphQLError } = require('graphql');
import { GraphQLError } from 'graphql';

import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { makeExecutableSchema } from '@graphql-tools/schema';
//import { WebSocketServer } from 'ws';
import WebSocket from 'ws';  // Importación por defecto de 'ws'
const { WebSocketServer } = WebSocket;

/* import { useServer } from 'graphql-ws/lib/use/ws'; */
import express from 'express';
import http from 'http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { PubSub } from 'graphql-subscriptions';
const pubsub = new PubSub();
import cors from 'cors';

// Importar modelos
import Author from './models/Author.js';
import Book from './models/Book.js';
import User from './models/User.js';
import Person from './models/Person.js'; 
// Conexión a MongoDB
//mongoose.connect('mongodb+srv://tu_usuario:tu_contraseña@tu_cluster.mongodb.net/graphql-library', {})
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
    
    allBooks(
      genre: String
    ): [Book!]!
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
    /* allBooks: async (root, { args }) => {
      console.log('allBooks:::genre',args.genre);//PRUEBA
      const filter = args.genre ? { genres: args.genre } : {};
      return await Book.find(filter).populate('author');
    },  */
     allBooks: async (root, args) => {//CAMBIO
      
      const filter = args.genre ? { genres: args.genre } : {};
      return await Book.find(filter).populate('author');
    
    }, 
    allAuthors: async () => {
      return await Author.find();
    },
    /* allAuthors: async (_, __, { dataSources }) => {
      const authors = await dataSources.authorAPI.getAllAuthors(); // Obtienes todos los autores
      const books = await dataSources.bookAPI.getAllBooks(); // Obtienes todos los libros

      // Asocias el número de libros de cada autor
      return authors.map(author => ({
        ...author,
        bookCount: books.filter(book => book.authorId === author.id).length
      }));
    }, */
    me: (root, args, context) => {
      const {  genres } = args;  //CAMBIO
	    console.log('me:::args',args);
      console.log('me:::genre',args.genre);
      console.log('me:::context.currentUser',context.currentUser);
      if (!context.currentUser) {
        throw new GraphQLError('Not authenticated in recomendatio', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
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
        passwordHash
      });
      try {
        return await user.save();
      } catch (error) {
        throw new GraphQLError('Error al crear usuario', {
          extensions: { code: 'BAD_USER_INPUT', error }
        });
      }
    },

    login: async (root, { username, password }) => {
      const user = await User.findOne({ username });
      const passwordCorrect = user === null ? false : await bcrypt.compare(password, user.passwordHash);
      if (!(user && passwordCorrect)) {
        throw new GraphQLError('Credenciales incorrectas', {
          extensions: { code: 'BAD_USER_INPUT' }
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
        address: { street: args.street, city: args.city }
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
    allBooks: async (root, args) => {
      console.log('allBooks::::NEW ',args)
      console.log('allBooks::::NEW args.genre ',args.genre)
      const filter = args.genre ? { genres: args.genre } : {};
      return await Book.find(filter).populate('author');
    
    },

    addBook: async (root, args, context) => {
      const { title, published, genres } = args;
      const authorName = args.author.name;
      /* if (!context.currentUser) {
        throw new GraphQLError('No autorizado', { extensions: { code: 'UNAUTHORIZED' } });
      } */
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

// Crear el esquema ejecutable
const schema = makeExecutableSchema({ typeDefs, resolvers });

const app = express();
const httpServer = http.createServer(app);

// Configurar CORS para permitir acceso desde tu front-end
const corsOptions = {
  origin: 'https://jaoreactgraphqlfront.onrender.com',  // Dominio de tu front-end
  //methods: ['GET', 'POST'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']

};

app.use(cors(corsOptions));
app.use((req, res, next) => {
  console.log('Incoming Request:', req.method, req.path);
  console.log('Headers:', req.headers);
  const authHeader = req.headers.authorization;
  console.log('authHeader:', authHeader);
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    console.log('app.use:::token:', token);
    try {
      req.currentUser = jwt.verify(token, 'SECRET_KEY');
      console.error('app.use::::req.currentUser',req.currentUser);
    } catch (e) {
      console.error('Invalid token');
    }
  }


  next();
});

// Configurar WebSocketServer

const wsServer = new WebSocket.Server({
  server: httpServer,
  path: '/graphql',handleProtocols: (protocols) => {
    // Asegúrate de que el protocolo WebSocket esté bien manejado.
    return protocols.includes('graphql-ws');
  },
  // Agrega esto para permitir CORS
  cors: {
    origin: 'https://jaoreactgraphqlfront.onrender.com',  // Permitir tu front-end
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  }
});




/* useServer({
  schema,
  context: async (ctx, msg, args) => {
    const auth = ctx.connectionParams?.authorization || '';
    console.log('useServer:::auth:', auth);
    if (auth.startsWith('Bearer ')) {
      try {
        const token = auth.substring(7);
        const decodedToken = jwt.verify(token, JWT_SECRET);
        const currentUser = await User.findById(decodedToken.id);
        console.log('useServer:::Decoded token:', decodedToken);
        console.log('useServer:::Current user:', currentUser);

        return { currentUser };
      } catch (error) {
        console.error('useServer:::Error verifying token:', error);
      }
    }
    return {};
  },
}, wsServer); */

// Configurar Apollo Server para HTTP
const server = new ApolloServer({
  schema,
  context: async ({ req }) => {
    const auth = req.headers.authorization || '';
    console.log('server:::auth:', auth);
    if (auth.startsWith('Bearer ')) {
      const token = auth.substring(7);
      const decodedToken = jwt.verify(token, JWT_SECRET);
      console.log('server:::Decoded token:', token);
      console.log('server:::Current user:', decodedToken);
      const currentUser = await User.findById(decodedToken.id);
      console.log('server:::Current user:', currentUser);
      if (!currentUser) {
        console.error('server:::No user found for this token');
        throw new Error('Not authenticated');
      }
      return { currentUser };
    }
    console.error('server:::No authorization header found or invalid format');
    throw new Error('Not authenticated');

  },
});
await server.start();

app.use(
  '/graphql',
  express.json(),
  expressMiddleware(server)
);

// Iniciar el servidor
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`Server JAO is running at http://localhost:${PORT}/graphql`);
  console.log(`WebSocket subscriptions are running at ws://localhost:${PORT}/graphql`);
}); 