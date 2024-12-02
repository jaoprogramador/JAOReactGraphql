//VERSION SIN ERRORES EN DEPLOY PERO SIN PERMITIR LOGG
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { makeExecutableSchema } from '@graphql-tools/schema';
//import { WebSocketServer } from 'ws';
import WebSocket from 'ws';  // Importación por defecto de 'ws'
import { GraphQLError } from 'graphql';
import { useServer } from 'graphql-ws/lib/use/ws';
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
const { WebSocketServer } = WebSocket;
const JWT_SECRET = 'SECRET_KEY';
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
    booksByFavoriteGenre(token: String!): [Book!]!

    
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
    booksByFavoriteGenre: async (root, { token }) => {
      try {
        console.log('booksByFavoriteGenre:::token',token);
        // Verificar el token
        const decodedToken = jwt.verify(token, JWT_SECRET);
        console.log('booksByFavoriteGenre:::decodedToken',decodedToken);
        // Encontrar al usuario
        const currentUser = await User.findById(decodedToken.id);
        console.log('booksByFavoriteGenre:::currentUser',currentUser);
        if (!currentUser) {
          throw new Error('Usuario no encontrado');
        }

        // Buscar libros según el género favorito
        const genre = currentUser.favoriteGenre;
        console.log('booksByFavoriteGenre:::genre',genre);
        return await Book.find({ genres: genre }).populate('author');
      } catch (error) {
        throw new Error('Token inválido o no autorizado');
      }
    },

    personCount: async () => await Person.countDocuments(),
    allPersons: async () => await Person.find({}),
    findPerson: async (root, args) => await Person.findOne({ name: args.name }),
    allBooks: async (root, { genre }) => {
      const filter = genre ? { genres: genre } : {};
      return await Book.find(filter).populate('author');
    },
    //CAMBIO PARA ERROR getAllFavourite
    allAuthors: async () => {
      return await Author.find();
    },
    me: (root, args, context) => {
      return context.currentUser;
    },/* booksByFavoriteGenre: async (root, args, context) => {
      if (!context.currentUser) {
        throw new GraphQLError('No autorizado', { extensions: { code: 'UNAUTHORIZED' } });
      }
      const genre = context.currentUser.favoriteGenre;
      return await Book.find({ genres: genre }).populate('author');
    }, */
    
    
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
    addBook: async (root, args, context) => {
      const { title, published, genres } = args;
      const authorName = args.author.name;
      console.log('addBook::::',args.title);
      console.log('addBook::::',args.published);
      console.log('addBook::::',args.genres);
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
      console.log('addBook::::author',author);
      return await Book.findById(book._id).populate('author');
    },
    //ERROR.ADDBOOK
    /* addBook: async (root, args, context) => {
      const { title, published, genres } = args;
      const authorName = args.author.name;
      if (!context.currentUser) {
        throw new GraphQLError('No autorizado', { extensions: { code: 'UNAUTHORIZED' } });
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
    }, */
    updateAuthor: async (_, { name, born }) => {
      console.log('updateAuthor::::name',name);
      console.log('updateAuthor::::born',born);
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
      console.log('updateAuthor::::author',author);
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
  methods: ['GET', 'POST'],
  credentials: true,
};

app.use(cors(corsOptions));
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




useServer({
  schema,
  context: async (ctx, msg, args) => {
    const auth = ctx.connectionParams?.authorization || '';
    if (auth.startsWith('Bearer ')) {
      const token = auth.substring(7);
      const decodedToken = jwt.verify(token, JWT_SECRET);
      const currentUser = await User.findById(decodedToken.id);
      return { currentUser };
    }
    return {};
  },
}, wsServer);

// Configurar Apollo Server para HTTP
const server = new ApolloServer({
  schema,
  context: async ({ req }) => {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) {
      const token = auth.substring(7);
      const decodedToken = jwt.verify(token, JWT_SECRET);
      const currentUser = await User.findById(decodedToken.id);
      return { currentUser };
    }
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
  console.log(`Server JAO is running at https://jaoreactgraphqlfront.onrender.com/graphql`);
  console.log(`WebSocket subscriptions are running at ws://https://jaoreactgraphqlfront.onrender.com/graphql`);
}); 