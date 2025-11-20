import express from 'express';
import {authenticateToken, normalizeDocument} from '../helpers.js';
import { poolWrite, poolRead } from'../dbConnection.js';
const router = express.Router();


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
 *                 description: "Número da conta de destino ('12345-6')."
 *               valor:
 *                 type: number
 *                 description: Valor a ser transferido.
 *     responses:
 *       '200':
 *         description: Transferência realizada com sucesso.
 *       '400':
 *         description: "Erro na requisição (saldo insuficiente)"
 *       '403':
 *         description: Acesso não autorizado à conta de origem.
 */
router.post('/transferencia', authenticateToken, async (req, res) => {
  const { conta_origem_id, numero_conta_destino, valor } = req.body;
  const { user } = req;
  const client = await poolWrite.connect();

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



/**
 * @swagger
 * /transacoes/saque:
 *   post:
 *     summary: Realiza um saque em uma conta
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
 *                 description: ID da conta de onde será feito o saque.
 *               valor:
 *                 type: number
 *                 description: Valor a ser sacado.
 *     responses:
 *       '200':
 *         description: Saque realizado com sucesso.
 *       '400':
 *         description: Erro na requisição (saldo insuficiente)
 *       '403':
 *         description: Acesso não autorizado à conta.
 */
router.post('/saque', authenticateToken, async (req, res) => {
  const { conta_origem_id, valor } = req.body;
  const { user } = req;
  const client = await poolWrite.connect();

  try {
    if (!conta_origem_id || !valor || valor <= 0) {
      return res.status(400).json({ error: 'Conta e valor válidos são obrigatórios.' });
    }

    await client.query('BEGIN');

    // Verifica conta e saldo
    const result = await client.query(
      'SELECT cliente_documento, saldo FROM conta WHERE id = $1 FOR UPDATE',
      [conta_origem_id]
    );

    if (result.rowCount === 0) {
      throw new Error('Conta não encontrada.');
    }

    const conta = result.rows[0];

    // Verifica dono da conta
    if (conta.cliente_documento !== user.documento) {
      return res.status(403).json({ error: 'Acesso não autorizado à conta.' });
    }

    if (parseFloat(conta.saldo) < valor) {
      throw new Error('Saldo insuficiente.');
    }

    // Atualiza saldo
    await client.query('UPDATE conta SET saldo = saldo - $1 WHERE id = $2', [valor, conta_origem_id]);

    // Registra transação
    await client.query(
      `INSERT INTO transacao (conta_origem_id, valor, tipo, descricao)
       VALUES ($1, $2, 'SAQUE', 'Saque realizado em conta')`,
      [conta_origem_id, valor]
    );

    await client.query('COMMIT');
    res.status(200).json({ message: 'Saque realizado com sucesso.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro no saque:', error);
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /transacoes/deposito:
 *   post:
 *     summary: Realiza um depósito em uma conta
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
 *               conta_destino_id:
 *                 type: integer
 *                 description: ID da conta que receberá o depósito.
 *               valor:
 *                 type: number
 *                 description: Valor a ser depositado.
 *     responses:
 *       '200':
 *         description: Depósito realizado com sucesso.
 *       '400':
 *         description: Erro na requisição
 *       '403':
 *         description: Acesso não autorizado (quando cliente tenta depositar em outra conta).
 */
router.post('/deposito', authenticateToken, async (req, res) => {
  const { conta_destino_id, valor } = req.body;
  const { user } = req;
  const client = await poolWrite.connect();

  try {
    if (!conta_destino_id || !valor || valor <= 0) {
      return res.status(400).json({ error: 'Conta e valor válidos são obrigatórios.' });
    }

    await client.query('BEGIN');

    const result = await client.query(
      'SELECT cliente_documento FROM conta WHERE id = $1 FOR UPDATE',
      [conta_destino_id]
    );

    if (result.rowCount === 0) {
      throw new Error('Conta não encontrada.');
    }

    const contaDestino = result.rows[0];

    // Somente o dono ou o gerente pode depositar
    if (contaDestino.cliente_documento !== user.documento && user.role !== 'gerente') {
      return res.status(403).json({ error: 'Acesso não autorizado à conta de destino.' });
    }

    // Atualiza saldo
    await client.query('UPDATE conta SET saldo = saldo + $1 WHERE id = $2', [valor, conta_destino_id]);

    // Registra transação
    await client.query(
      `INSERT INTO transacao (conta_destino_id, valor, tipo, descricao)
       VALUES ($1, $2, 'DEPOSITO', 'Depósito em conta')`,
      [conta_destino_id, valor]
    );

    await client.query('COMMIT');
    res.status(200).json({ message: 'Depósito realizado com sucesso.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro no depósito:', error);
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

export default router;