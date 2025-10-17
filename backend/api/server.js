const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const swaggerUi = require('swagger-ui-express');
const swaggerJSDoc = require('swagger-jsdoc');
const jwt = require('jsonwebtoken');

// --- CONFIGURAÇÕES ---
const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'seu-segredo-super-secreto-para-desenvolvimento';

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json());

// --- CONFIGURAÇÃO DO SWAGGER ---
// Define a URL do servidor dinamicamente com base no ambiente
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
    apis: ['./server.js'],
};
const swaggerSpec = swaggerJSDoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));


// --- CONEXÃO COM O BANCO DE DADOS ---
const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});


// --- MIDDLEWARE DE AUTENTICAÇÃO ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user; // user.documento e user.role
        next();
    });
};


// =================================================================
// --- ENDPOINTS ---
// =================================================================

// --- ROTAS DE CLIENTES E AUTENTICAÇÃO ---

/**
 * @swagger
 * /clientes:
 *   post:
 *     summary: Cadastra um novo cliente
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
 *               primeiro_nome:
 *                 type: string
 *               sobrenome_razao_social:
 *                 type: string
 *               senha:
 *                 type: string
 *     responses:
 *       '201':
 *         description: Cliente criado
 */
app.post('/clientes', async (req, res) => {
    const { documento, primeiro_nome, sobrenome_razao_social, senha, is_pessoa_juridica = false } = req.body;
    try {
        const query = `
            INSERT INTO cliente (documento, primeiro_nome, sobrenome_razao_social, senha_hash, is_pessoa_juridica)
            VALUES ($1, $2, $3, crypt($4, gen_salt('bf')), $5)
            RETURNING documento, primeiro_nome, data_criacao;
        `;
        const result = await pool.query(query, [documento, primeiro_nome, sobrenome_razao_social, senha, is_pessoa_juridica]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao cadastrar cliente:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

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
    try {
        const query = "SELECT documento, role FROM cliente WHERE documento = $1 AND senha_hash = crypt($2, senha_hash) AND deleted_at IS NULL;";
        const result = await pool.query(query, [documento, senha]);

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

/**
 * @swagger
 * /clientes/{documento}:
 *   get:
 *     summary: Busca dados de um cliente específico
 *     tags: [Autenticação & Clientes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documento
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Dados do cliente
 */
app.get('/clientes/:documento', authenticateToken, async (req, res) => {
    const { documento } = req.params;
    const { user } = req;

    if (user.documento !== documento && user.role !== 'gerente') {
        return res.status(403).json({ error: 'Acesso não autorizado.' });
    }

    try {
        const query = 'SELECT documento, primeiro_nome, sobrenome_razao_social, is_pessoa_juridica, role, data_criacao FROM cliente WHERE documento = $1 AND deleted_at IS NULL';
        const result = await pool.query(query, [documento]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Cliente não encontrado.' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao buscar cliente:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

/**
 * @swagger
 * /clientes/{documento}:
 *   put:
 *     summary: Atualiza os dados de um cliente
 *     tags: [Autenticação & Clientes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documento
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               primeiro_nome:
 *                 type: string
 *               sobrenome_razao_social:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Cliente atualizado com sucesso
 */
app.put('/clientes/:documento', authenticateToken, async (req, res) => {
    const { documento } = req.params;
    const { user } = req;

    if (user.documento !== documento && user.role !== 'gerente') {
        return res.status(403).json({ error: 'Acesso não autorizado.' });
    }

    const { primeiro_nome, sobrenome_razao_social } = req.body;
    const fields = [];
    const values = [];
    let queryIndex = 1;

    if (primeiro_nome) {
        fields.push(`primeiro_nome = $${queryIndex++}`);
        values.push(primeiro_nome);
    }
    if (sobrenome_razao_social) {
        fields.push(`sobrenome_razao_social = $${queryIndex++}`);
        values.push(sobrenome_razao_social);
    }

    if (fields.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar foi fornecido.' });
    }

    values.push(documento);
    const updateQuery = `
        UPDATE cliente 
        SET ${fields.join(', ')} 
        WHERE documento = $${queryIndex} AND deleted_at IS NULL
        RETURNING documento, primeiro_nome, sobrenome_razao_social;
    `;

    try {
        const result = await pool.query(updateQuery, values);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Cliente não encontrado ou está inativo.' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao atualizar cliente:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});


/**
 * @swagger
 * /clientes/{documento}/contas:
 *   get:
 *     summary: Lista as contas de um cliente específico
 *     tags: [Contas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documento
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Lista de contas do cliente
 */
app.get('/clientes/:documento/contas', authenticateToken, async (req, res) => {
    const { documento } = req.params;
    const { user } = req;

    if (user.documento !== documento && user.role !== 'gerente') {
        return res.status(403).json({ error: 'Acesso não autorizado.' });
    }

    try {
        const query = 'SELECT id, numero_conta, agencia, saldo, status FROM conta WHERE cliente_documento = $1';
        const result = await pool.query(query, [documento]);
        res.json(result.rows);
    } catch (error) {
        console.error('Erro ao listar contas do cliente:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

/**
 * @swagger
 * /clientes/{documento}/desativar:
 *   patch:
 *     summary: Desativa um cliente (Soft Delete)
 *     tags: [Autenticação & Clientes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documento
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Cliente desativado com sucesso
 */
app.patch('/clientes/:documento/desativar', authenticateToken, async (req, res) => {
    const { documento } = req.params;
    const { user } = req;

    if (user.documento !== documento && user.role !== 'gerente') {
        return res.status(403).json({ error: 'Acesso não autorizado.' });
    }

    try {
        const query = 'UPDATE cliente SET deleted_at = NOW() WHERE documento = $1 AND deleted_at IS NULL RETURNING documento;';
        const result = await pool.query(query, [documento]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Cliente não encontrado ou já desativado.' });
        }
        res.status(200).json({ message: 'Cliente desativado com sucesso.' });
    } catch (error) {
        console.error('Erro ao desativar cliente:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});


// --- ROTAS DE CONTAS ---

/**
 * @swagger
 * /contas/{id}:
 *   put:
 *     summary: Atualiza o status de uma conta (Apenas Gerentes)
 *     tags: [Contas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [ATIVA, BLOQUEADA, ENCERRADA]
 *     responses:
 *       '200':
 *         description: Status da conta atualizado com sucesso
 */

/**
 * @swagger
 * /contas/{id}:
 *   delete:
 *     summary: Exclui uma conta bancária (se o saldo for zero)
 *     tags: [Contas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       '200':
 *         description: Conta excluída com sucesso
 */

/**
 * @swagger
 * /contas/{contaId}/cartoes:
 *   get:
 *     summary: Lista os cartões de uma conta específica
 *     tags: [Cartões]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: contaId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       '200':
 *         description: Lista de cartões da conta
 */

/**
 * @swagger
 * /contas/{contaId}/cartoes:
 *   post:
 *     summary: Solicita um novo cartão para uma conta
 *     tags: [Cartões]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: contaId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       '201':
 *         description: Cartão criado com sucesso
 */

/**
 * @swagger
 * /cartoes/{id}:
 *   delete:
 *     summary: Exclui um cartão
 *     tags: [Cartões]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       '200':
 *         description: Cartão excluído com sucesso
 */

/**
 * @swagger
 * /contas/{contaId}/transacoes:
 *   get:
 *     summary: Consulta o extrato (transações) de uma conta
 *     tags: [Transações]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: contaId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       '200':
 *         description: Extrato da conta
 */

/**
 * @swagger
 * /transacoes/transferencia:
 *   post:
 *     summary: Realiza uma transferência entre contas
 *     tags: [Transações]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               conta_origem_id:
 *                 type: integer
 *                 description: ID da sua conta de origem.
 *               numero_conta_destino:
 *                 type: string
 *                 description: "Número da conta de destino (ex: '12345-6')."
 *               valor:
 *                 type: number
 *                 description: Valor a ser transferido.
 *     responses:
 *       '200':
 *         description: Transferência realizada com sucesso.
 *       '400':
 *         description: Erro na requisição (ex: saldo insuficiente).
 *       '403':
 *         description: Acesso não autorizado à conta de origem.
 */


// --- INICIAR O SERVIDOR ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor da API a rodar em http://localhost:${PORT}`);
    console.log(`📄 Documentação da API disponível em http://localhost:${PORT}/api-docs`);
});