const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const swaggerUi = require('swagger-ui-express');
const swaggerJSDoc = require('swagger-jsdoc');

// 2. Configurações da Aplicação
const app = express();
const PORT = 3000;

// 3. Middlewares
app.use(cors());
app.use(express.json());

// =================================================================
// Configuração do Swagger / OpenAPI
// =================================================================
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Bank API',
      version: '1.0.0',
      description: 'Uma API para gerenciar usuários e operações bancárias.',
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: 'Servidor de Desenvolvimento',
      },
    ],
  },
  // Caminho para os arquivos que contêm as anotações da API
  apis: ['./server.js'], 
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);

// Rota para servir a documentação do Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
// =================================================================


// 4. Configuração da Conexão com o Banco de Dados
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

// 5. Definição das Rotas (Endpoints) do CRUD com documentação

/**
 * @swagger
 * /users:
 * get:
 * summary: Retorna uma lista de todos os usuários
 * description: Recupera o ID, nome de usuário e saldo de todos os usuários não deletados.
 * responses:
 * 200:
 * description: Uma lista de usuários.
 * content:
 * application/json:
 * schema:
 * type: array
 * items:
 * type: object
 * properties:
 * id:
 * type: integer
 * example: 1
 * username:
 * type: string
 * example: user_1
 * balance:
 * type: string
 * example: "1540.22"
 */
app.get('/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, balance FROM users WHERE deleted = false ORDER BY id;');
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar usuários:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * @swagger
 * /users/{id}/operations:
 * get:
 * summary: Retorna as operações de um usuário específico
 * description: Recupera uma lista de todas as transações para um usuário, dado o seu ID.
 * parameters:
 * - in: path
 * name: id
 * required: true
 * description: ID numérico do usuário para buscar as operações.
 * schema:
 * type: integer
 * responses:
 * 200:
 * description: Uma lista de operações do usuário.
 * content:
 * application/json:
 * schema:
 * type: array
 * items:
 * type: object
 * properties:
 * id:
 * type: integer
 * example: 1234
 * user_id:
 * type: integer
 * example: 5
 * operation_type:
 * type: string
 * example: "deposit"
 * amount:
 * type: string
 * example: "200.00"
 * balance_before:
 * type: string
 * example: "550.00"
 * related_user:
 * type: integer
 * nullable: true
 * example: 12
 * created_at:
 * type: string
 * format: date-time
 * example: "2025-10-16T13:45:00.000Z"
 */
app.get('/users/:id/operations', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM operations WHERE user_id = $1 ORDER BY created_at DESC;',
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error(`Erro ao buscar operações para o usuário ${id}:`, error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 6. Iniciar o Servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor da API rodando em http://localhost:${PORT}`);
  console.log(`📄 Documentação da API disponível em http://localhost:${PORT}/api-docs`);
});