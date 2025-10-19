import express from 'express';
import cors from 'cors';
import  pool  from './dbConnection.js';
import { authenticateToken } from './helpers.js';
import swaggerUi from 'swagger-ui-express';
import swaggerJSDoc from 'swagger-jsdoc';
import jwt from 'jsonwebtoken';


// --- CONFIGURAÇÕES ---
const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'seu-segredo-super-secreto-para-desenvolvimento';

// --- FUNÇÃO AUXILIAR ---
const normalizeDocument = (doc = '') => doc.replace(/[^\d]/g, '');

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json());

// --- CONFIGURAÇÃO DO SWAGGER ---
const serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Bank API Refatorada',
      version: '3.0.0',
      description: 'API do banco digital com novas regras de negócio e tabelas.',
    },
    servers: [{ url: serverUrl, description: process.env.NODE_ENV === 'production' ? 'Servidor de Produção' : 'Servidor Local' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./server.js', './routes/*.js'],
};
const swaggerSpec = swaggerJSDoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// =================================================================
// --- ENDPOINTS ---
// =================================================================

// --- ROTAS DE CLIENTES ---

// -- ROTAS DE AUTENTICACAO

/**
 * @swagger
 * /login:
 *   post:
 *     summary: Realiza o login do cliente
 *     tags: [Autenticação & Clientes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               documento:
 *                 type: string
 *               senha:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Login bem-sucedido
 */
app.post('/login', async (req, res) => {
  const { documento, senha } = req.body;
  const normalizedDoc = normalizeDocument(documento);
  try {
    const query = "SELECT documento, role FROM cliente WHERE documento = $1 AND senha_hash = crypt($2, senha_hash) AND deleted_at IS NULL;";
    const result = await pool.query(query, [normalizedDoc, senha]);

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Credenciais inválidas ou cliente desativado.' });
    }

    const user = { documento: result.rows[0].documento, role: result.rows[0].role };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '8h' });

    res.json({ token });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});


import clienteRoutes from './routes/clienteRoutes.js';
app.use('/clientes', clienteRoutes);

import contaRoutes from './routes/contaRoutes.js';
app.use('/contas', contaRoutes);

import cartaoRoutes from './routes/cartaoRoutes.js';
app.use('/cartoes', cartaoRoutes);

import transacaoRoutes from './routes/transacaoRoutes.js';
app.use('/transacoes', transacaoRoutes);


// --- INICIAR O SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🚀 Servidor da API a rodar em http://localhost:${PORT}`);
  console.log(`📄 Documentaaaação da API disponível em http://localhost:${PORT}/api-docs`);
});