
import express from 'express';
import {authenticateToken, normalizeDocument} from '../helpers.js';
import pool from '../dbConnection.js';
const router = express.Router();

/**
 * @swagger
 * /clientes:
 *   post:
 *     summary: Cadastra um novo cliente
 *     tags: [Clientes]
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
router.post('', async (req, res) => {
  const { documento, primeiro_nome, sobrenome_razao_social, senha, is_pessoa_juridica = false } = req.body;

  if (!documento || !primeiro_nome || !sobrenome_razao_social || !senha) {
    return res.status(400).json({ error: 'Todos os campos obrigatórios devem ser preenchidos.' });
  }

  const normalizedDoc = normalizeDocument(documento);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Criar cliente
    const clienteQuery = `
      INSERT INTO cliente (documento, primeiro_nome, sobrenome_razao_social, senha_hash, is_pessoa_juridica)
      VALUES ($1, $2, $3, crypt($4, gen_salt('bf')), $5)
      RETURNING documento, primeiro_nome, data_criacao;
    `;
    const clienteResult = await client.query(clienteQuery, [normalizedDoc, primeiro_nome, sobrenome_razao_social, senha, is_pessoa_juridica]);
    const cliente = clienteResult.rows[0];

    // Gerar número de conta único
    let numeroConta, contaResult;
    const agencia = '0001';
    do {
      numeroConta = Math.floor(100000 + Math.random() * 900000) + '-' + Math.floor(Math.random() * 10);
      contaResult = await client.query('SELECT id FROM conta WHERE numero_conta = $1', [numeroConta]);
    } while (contaResult.rowCount > 0);

    // Criar conta
    const contaInsertQuery = `
      INSERT INTO conta (cliente_documento, numero_conta, agencia, saldo, status)
      VALUES ($1, $2, $3, 0, 'ATIVA')
      RETURNING id, numero_conta;
    `;
    contaResult = await client.query(contaInsertQuery, [normalizedDoc, numeroConta, agencia]);
    const conta = contaResult.rows[0];

    // Criar cartão virtual único vinculado à conta
    let cartaoId;
    let cartaoExist;
    do {
      cartaoId = Math.floor(1000000000000000 + Math.random() * 9000000000000000); // 16 dígitos
      cartaoExist = await client.query('SELECT id FROM cartao WHERE numero_hash = md5($1::text)', [cartaoId]);
    } while (cartaoExist.rowCount > 0);

    const nomeTitular = `${primeiro_nome} ${sobrenome_razao_social}`;
    const cartaoQuery = `
      INSERT INTO cartao (conta_id, numero_hash, cvv_hash, nome_titular, data_validade, tipo)
      VALUES ($1, md5($2::text), md5(random()::text), $3, current_date + interval '5 year', 'VIRTUAL')
      RETURNING id, tipo, data_emissao;
    `;
    const cartaoResult = await client.query(cartaoQuery, [conta.id, cartaoId, nomeTitular]);
    const cartao = cartaoResult.rows[0];

    
    await client.query('COMMIT');

    res.status(201).json({ cliente, conta, cartao });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao criar cliente, conta e cartão:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  } finally {
    client.release();
  }
});


/**
 * @swagger
 * /clientes/{documento}/contas:
 *   post:
 *     summary: Cria uma nova conta para um cliente existente
 *     tags: [Contas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documento
 *         required: true
 *         schema:
 *           type: string
 *         description: Documento do cliente (CPF ou CNPJ)
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tipo:
 *                 type: string
 *                 description: Tipo de conta ( 'CORRENTE', 'POUPANCA')
 *                 example: CORRENTE
 *     responses:
 *       '201':
 *         description: Conta criada com sucesso
 *       '404':
 *         description: Cliente não encontrado
 *       '500':
 *         description: Erro interno do servidor
 */
router.post('/:documento/contas', authenticateToken, async (req, res) => {
  const { documento } = req.params;
  const normalizedDoc = normalizeDocument(documento);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verifica se o cliente existe
    const clienteResult = await client.query('SELECT primeiro_nome, sobrenome_razao_social FROM cliente WHERE documento = $1', [normalizedDoc]);
    if (clienteResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    const cliente = clienteResult.rows[0];

    // Gera número de conta único
    let numeroConta, contaResult;
    const agencia = '0001';
    do {
      numeroConta = Math.floor(100000 + Math.random() * 900000) + '-' + Math.floor(Math.random() * 10);
      contaResult = await client.query('SELECT id FROM conta WHERE numero_conta = $1', [numeroConta]);
    } while (contaResult.rowCount > 0);

    // Cria a conta
    const contaInsertQuery = `
      INSERT INTO conta (cliente_documento, numero_conta, agencia, saldo, status)
      VALUES ($1, $2, $3, 0, 'ATIVA')
      RETURNING id, numero_conta, agencia, status;
    `;
    const contaInsertResult = await client.query(contaInsertQuery, [normalizedDoc, numeroConta, agencia, tipo]);
    const conta = contaInsertResult.rows[0];

    // Cria o cartão virtual
    let cartaoId;
    let cartaoExist;
    do {
      cartaoId = Math.floor(1000000000000000 + Math.random() * 9000000000000000); // 16 dígitos
      cartaoExist = await client.query('SELECT id FROM cartao WHERE numero_hash = md5($1::text)', [cartaoId]);
    } while (cartaoExist.rowCount > 0);

    const nomeTitular = `${cliente.primeiro_nome} ${cliente.sobrenome_razao_social}`;
    const cartaoQuery = `
      INSERT INTO cartao (conta_id, numero_hash, cvv_hash, nome_titular, data_validade, tipo)
      VALUES ($1, md5($2::text), md5(random()::text), $3, current_date + interval '5 year', 'VIRTUAL')
      RETURNING id, tipo, data_emissao;
    `;
    const cartaoResult = await client.query(cartaoQuery, [conta.id, cartaoId, nomeTitular]);
    const cartao = cartaoResult.rows[0];

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Conta criada com sucesso.',
      conta,
      cartao
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao criar conta:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  } finally {
    client.release();
  }
});


/**
 * @swagger
 * /clientes:
 *   get:
 *     summary: Lista todos os clientes (Apenas Gerentes)
 *     tags: [Clientes]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Lista de clientes retornada com sucesso
 *       '403':
 *         description: Acesso não autorizado
 */
router.get('', authenticateToken, async (req, res) => {
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
 *     tags: [Clientes]
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
router.get('/:documento', authenticateToken, async (req, res) => {
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
 *     tags: [Clientes]
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
router.put('/:documento', authenticateToken, async (req, res) => {
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
router.get('/:documento/contas', authenticateToken, async (req, res) => {
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
 *     tags: [Clientes]
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
router.patch('/:documento/desativar', authenticateToken, async (req, res) => {
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


export default router;