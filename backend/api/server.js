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
  const normalizedDoc = normalizeDocument(documento);
  try {
    const query = `
            INSERT INTO cliente (documento, primeiro_nome, sobrenome_razao_social, senha_hash, is_pessoa_juridica)
            VALUES ($1, $2, $3, crypt($4, gen_salt('bf')), $5)
            RETURNING documento, primeiro_nome, data_criacao;
        `;
    const result = await pool.query(query, [normalizedDoc, primeiro_nome, sobrenome_razao_social, senha, is_pessoa_juridica]);
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

/**
 * @swagger
 * /clientes:
 *   get:
 *     summary: Lista todos os clientes (Apenas Gerentes)
 *     tags: [Autenticação & Clientes]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Lista de clientes retornada com sucesso
 *       '403':
 *         description: Acesso não autorizado
 */
app.get('/clientes', authenticateToken, async (req, res) => {
  if (req.user.role !== 'gerente') {
    return res.status(403).json({ error: 'Acesso não autorizado. Apenas gerentes podem realizar esta ação.' });
  }

  try {
    const query = `
            SELECT documento, primeiro_nome, sobrenome_razao_social, is_pessoa_juridica, role, data_criacao 
            FROM cliente 
            WHERE deleted_at IS NULL
            ORDER BY data_criacao;
        `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar clientes:', error);
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
  const normalizedDoc = normalizeDocument(documento);
  const { user } = req;

  if (user.documento !== normalizedDoc && user.role !== 'gerente') {
    return res.status(403).json({ error: 'Acesso não autorizado.' });
  }

  try {
    const query = 'SELECT documento, primeiro_nome, sobrenome_razao_social, is_pessoa_juridica, role, data_criacao FROM cliente WHERE documento = $1 AND deleted_at IS NULL';
    const result = await pool.query(query, [normalizedDoc]);

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
 *               senha:
 *                 type: string
 *                 format: password
 *                 description: "Opcional. Forneça apenas se desejar alterar a senha."
 *               foto_identidade_url:
 *                 type: string
 *                 format: uri
 *                 description: "Opcional. URL para a nova foto."
 *     responses:
 *       '200':
 *         description: Cliente atualizado com sucesso
 */
app.put('/clientes/:documento', authenticateToken, async (req, res) => {
    const { documento } = req.params;
    const normalizedDoc = normalizeDocument(documento);
    const { user } = req;

    if (user.documento !== normalizedDoc && user.role !== 'gerente') {
        return res.status(403).json({ error: 'Acesso não autorizado.' });
    }

    const { primeiro_nome, sobrenome_razao_social, senha, foto_identidade_url } = req.body;
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
    if (senha) {
        fields.push(`senha_hash = crypt($${queryIndex++}, gen_salt('bf'))`);
        values.push(senha);
    }
    if (foto_identidade_url) {
        fields.push(`foto_identidade_url = $${queryIndex++}`);
        values.push(foto_identidade_url);
    }

    if (fields.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar foi fornecido.' });
    }

    values.push(normalizedDoc);
    const updateQuery = `
        UPDATE cliente 
        SET ${fields.join(', ')} 
        WHERE documento = $${queryIndex} AND deleted_at IS NULL
        RETURNING documento, primeiro_nome, sobrenome_razao_social, foto_identidade_url;
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
  const normalizedDoc = normalizeDocument(documento);
  const { user } = req;

  if (user.documento !== normalizedDoc && user.role !== 'gerente') {
    return res.status(403).json({ error: 'Acesso não autorizado.' });
  }

  try {
    const query = 'SELECT id, numero_conta, agencia, saldo, status FROM conta WHERE cliente_documento = $1';
    const result = await pool.query(query, [normalizedDoc]);
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
  const normalizedDoc = normalizeDocument(documento);
  const { user } = req;

  if (user.documento !== normalizedDoc && user.role !== 'gerente') {
    return res.status(403).json({ error: 'Acesso não autorizado.' });
  }

  try {
    const query = 'UPDATE cliente SET deleted_at = NOW() WHERE documento = $1 AND deleted_at IS NULL RETURNING documento;';
    const result = await pool.query(query, [normalizedDoc]);

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
app.put('/contas/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const { user } = req;

  if (user.role !== 'gerente') {
    return res.status(403).json({ error: 'Acesso não autorizado. Apenas gerentes podem alterar o status da conta.' });
  }
  
  if (!['ATIVA', 'BLOQUEADA', 'ENCERRADA'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido.' });
  }

  try {
    const query = 'UPDATE conta SET status = $1 WHERE id = $2 RETURNING id, status;';
    const result = await pool.query(query, [status, id]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Conta não encontrada.' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar status da conta:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

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
app.delete('/contas/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { user } = req;

  try {
    const contaQuery = 'SELECT cliente_documento, saldo FROM conta WHERE id = $1';
    const contaResult = await pool.query(contaQuery, [id]);

    if (contaResult.rowCount === 0) {
      return res.status(404).json({ error: 'Conta não encontrada.' });
    }

    const contaData = contaResult.rows[0];
    if (contaData.cliente_documento !== user.documento && user.role !== 'gerente') {
      return res.status(403).json({ error: 'Acesso não autorizado.' });
    }

    if (parseFloat(contaData.saldo) !== 0.00) {
      return res.status(400).json({ error: 'Não é possível excluir conta com saldo diferente de zero.' });
    }

    await pool.query('DELETE FROM conta WHERE id = $1', [id]);
    res.status(200).json({ message: 'Conta excluída com sucesso.' });

  } catch (error) {
    console.error('Erro ao excluir conta:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});


// --- ROTAS DE CARTÕES ---

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
app.get('/contas/:contaId/cartoes', authenticateToken, async (req, res) => {
  const { contaId } = req.params;
  const { user } = req;

  try {
    const ownerCheck = await pool.query('SELECT cliente_documento FROM conta WHERE id = $1', [contaId]);
    if (ownerCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Conta não encontrada.' });
    }
    if (ownerCheck.rows[0].cliente_documento !== user.documento && user.role !== 'gerente') {
      return res.status(403).json({ error: 'Acesso não autorizado.' });
    }

    const query = 'SELECT id, nome_titular, data_validade, tipo, status FROM cartao WHERE conta_id = $1';
    const result = await pool.query(query, [contaId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar cartões:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

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
app.post('/contas/:contaId/cartoes', authenticateToken, async (req, res) => {
  const { contaId } = req.params;
  const { user } = req;

  try {
    const contaQuery = 'SELECT c.cliente_documento, cl.primeiro_nome, cl.sobrenome_razao_social FROM conta c JOIN cliente cl ON c.cliente_documento = cl.documento WHERE c.id = $1';
    const contaResult = await pool.query(contaQuery, [contaId]);

    if (contaResult.rowCount === 0) {
      return res.status(404).json({ error: 'Conta não encontrada.' });
    }

    if (contaResult.rows[0].cliente_documento !== user.documento) {
      return res.status(403).json({ error: 'Acesso não autorizado a esta conta.' });
    }

    const nomeTitular = `${contaResult.rows[0].primeiro_nome} ${contaResult.rows[0].sobrenome_razao_social}`;
    const cartaoQuery = `
            INSERT INTO cartao (conta_id, numero_hash, cvv_hash, nome_titular, data_validade, tipo)
            VALUES ($1, md5(random()::text || clock_timestamp()::text), md5(random()::text), $2, current_date + interval '5 year', 'VIRTUAL')
            RETURNING id, tipo, data_emissao;
        `;
    const cartaoResult = await pool.query(cartaoQuery, [contaId, nomeTitular]);

    res.status(201).json(cartaoResult.rows[0]);
  } catch (error) {
    console.error('Erro ao criar cartão:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});


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
app.delete('/cartoes/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { user } = req;

  try {
    const cartaoQuery = 'SELECT ca.id, co.cliente_documento FROM cartao ca JOIN conta co ON ca.conta_id = co.id WHERE ca.id = $1';
    const cartaoResult = await pool.query(cartaoQuery, [id]);

    if (cartaoResult.rowCount === 0) {
      return res.status(404).json({ error: 'Cartão não encontrado.' });
    }

    if (cartaoResult.rows[0].cliente_documento !== user.documento && user.role !== 'gerente') {
      return res.status(403).json({ error: 'Acesso não autorizado para excluir este cartão.' });
    }

    await pool.query('DELETE FROM cartao WHERE id = $1', [id]);
    res.status(200).json({ message: 'Cartão excluído com sucesso.' });

  } catch (error) {
    console.error('Erro ao excluir cartão:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// --- ROTAS DE TRANSAÇÕES ---

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
app.get('/contas/:contaId/transacoes', authenticateToken, async (req, res) => {
  const { contaId } = req.params;
  const { user } = req;

  try {
    const ownerCheck = await pool.query('SELECT cliente_documento FROM conta WHERE id = $1', [contaId]);
    if (ownerCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Conta não encontrada.' });
    }
    if (ownerCheck.rows[0].cliente_documento !== user.documento && user.role !== 'gerente') {
      return res.status(403).json({ error: 'Acesso não autorizado.' });
    }
    
    const query = `
            SELECT id, valor, tipo, descricao, data_hora 
            FROM transacao 
            WHERE conta_origem_id = $1 OR conta_destino_id = $1
            ORDER BY data_hora DESC;
        `;
    const result = await pool.query(query, [contaId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar transações:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

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
app.post('/transacoes/transferencia', authenticateToken, async (req, res) => {
  const { conta_origem_id, numero_conta_destino, valor } = req.body;
  const { user } = req;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const origemResult = await client.query('SELECT cliente_documento, saldo FROM conta WHERE id = $1 FOR UPDATE', [conta_origem_id]);
    if (origemResult.rowCount === 0) {
      throw new Error('Conta de origem não encontrada.');
    }
    const contaOrigem = origemResult.rows[0];

    if (contaOrigem.cliente_documento !== user.documento) {
      return res.status(403).json({ error: 'Acesso não autorizado à conta de origem.' });
    }
    if (parseFloat(contaOrigem.saldo) < valor) {
      throw new Error('Saldo insuficiente.');
    }

    const destinoResult = await client.query('SELECT id FROM conta WHERE numero_conta = $1', [numero_conta_destino]);
    if (destinoResult.rowCount === 0) {
      throw new Error('Conta de destino não encontrada.');
    }
    const conta_destino_id = destinoResult.rows[0].id;
    if (conta_origem_id == conta_destino_id) {
      throw new Error('A conta de origem e destino não podem ser a mesma.');
    }

    await client.query('UPDATE conta SET saldo = saldo - $1 WHERE id = $2', [valor, conta_origem_id]);
    await client.query('UPDATE conta SET saldo = saldo + $1 WHERE id = $2', [valor, conta_destino_id]);
    
    await client.query(
      `INSERT INTO transacao (conta_origem_id, conta_destino_id, valor, tipo, descricao) 
             VALUES ($1, $2, $3, 'TRANSFERENCIA', 'Transferência para conta ${numero_conta_destino}')`,
      [conta_origem_id, conta_destino_id, valor]
    );

    await client.query('COMMIT');
    res.status(200).json({ message: 'Transferência realizada com sucesso.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro na transferência:', error);
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});


// --- INICIAR O SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🚀 Servidor da API a rodar em http://localhost:${PORT}`);
  console.log(`📄 Documentação da API disponível em http://localhost:${PORT}/api-docs`);
});