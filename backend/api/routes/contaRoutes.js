import express from 'express';
import {authenticateToken, normalizeDocument} from '../helpers.js';
import { poolWrite, poolRead } from'../dbConnection.js';
const router = express.Router();


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
router.put('/:id', authenticateToken, async (req, res) => {
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
    const result = await poolWrite.query(query, [status, id]);
    
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
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { user } = req;

  try {
    const contaQuery = 'SELECT cliente_documento, saldo FROM conta WHERE id = $1';
    const contaResult = await poolRead.query(contaQuery, [id]);

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

    await poolWrite.query('DELETE FROM conta WHERE id = $1', [id]);
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
router.get('/:contaId/cartoes', authenticateToken, async (req, res) => {
  const { contaId } = req.params;
  const { user } = req;

  try {
    const ownerCheck = await poolRead.query('SELECT cliente_documento FROM conta WHERE id = $1', [contaId]);
    if (ownerCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Conta não encontrada.' });
    }
    if (ownerCheck.rows[0].cliente_documento !== user.documento && user.role !== 'gerente') {
      return res.status(403).json({ error: 'Acesso não autorizado.' });
    }

    const query = 'SELECT id, nome_titular, data_validade, tipo, status FROM cartao WHERE conta_id = $1';
    const result = await poolRead.query(query, [contaId]);
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
router.post('/:contaId/cartoes', authenticateToken, async (req, res) => {
  const { contaId } = req.params;
  const { user } = req;

  try {
    const contaQuery = 'SELECT c.cliente_documento, cl.primeiro_nome, cl.sobrenome_razao_social FROM conta c JOIN cliente cl ON c.cliente_documento = cl.documento WHERE c.id = $1';
    const contaResult = await poolRead.query(contaQuery, [contaId]);

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
    const cartaoResult = await poolWrite.query(cartaoQuery, [contaId, nomeTitular]);

    res.status(201).json(cartaoResult.rows[0]);
  } catch (error) {
    console.error('Erro ao criar cartão:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});



/**
 * @swagger
 * /contas/{contaId}/transacoes:
 *   get:
 *     summary: Consulta o extrato de transações de uma conta
 *     tags: [Transações]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: contaId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da conta a consultar
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Número máximo de transações por página
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Posição inicial para paginação
 *     responses:
 *       '200':
 *         description: Lista de transações retornada com sucesso
 *       '403':
 *         description: Acesso não autorizado
 *       '404':
 *         description: Conta não encontrada
 */
router.get('/:contaId/transacoes', authenticateToken, async (req, res) => {
  const { contaId } = req.params;
  const { limit = 10, offset = 0 } = req.query;
  const { user } = req;

  try {
    // --- Verifica se a conta existe e pertence ao usuário ---
    const ownerCheck = await poolRead.query(
      'SELECT cliente_documento FROM conta WHERE id = $1',
      [contaId]
    );
    if (ownerCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Conta não encontrada.' });
    }
    const contaDono = ownerCheck.rows[0].cliente_documento;

    if (contaDono !== user.documento && user.role !== 'gerente') {
      return res.status(403).json({ error: 'Acesso não autorizado.' });
    }

    // --- Busca as transações, com paginação ---
    const query = `
      SELECT 
        id, 
        conta_origem_id, 
        conta_destino_id, 
        valor, 
        tipo, 
        descricao, 
        data_hora 
      FROM transacao
      WHERE conta_origem_id = $1 OR conta_destino_id = $1
      ORDER BY data_hora DESC
      LIMIT $2 OFFSET $3;
    `;
    const result = await poolRead.query(query, [contaId, limit, offset]);

    // --- Mapeia resultado para adicionar "de", "para" e "balanco" ---
    const transacoes = result.rows.map(t => ({
      id: t.id,
      de: t.conta_origem_id,
      para: t.conta_destino_id,
      valor: t.valor,
      tipo: t.tipo,
      descricao: t.descricao,
      data_hora: t.data_hora,
      balanco: t.conta_origem_id == contaId ? -t.valor : t.valor
    }));

    res.status(200).json({
      conta_id: contaId,
      total: transacoes.length,
      limit: Number(limit),
      offset: Number(offset),
      transacoes
    });
  } catch (error) {
    console.error('Erro ao buscar transações:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});



export default router;