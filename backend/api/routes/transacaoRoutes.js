import express from 'express';
import {authenticateToken, normalizeDocument} from '../helpers.js';
import pool from '../dbConnection.js';
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


/**
 * @swagger
 * /transacoes/extrato:
 *   post:
 *     summary: Retorna o extrato (transações) de uma conta específica
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
 *               conta_id:
 *                 type: integer
 *                 description: ID da conta para consulta do extrato.
 *                 example: 12
 *               limit:
 *                 type: integer
 *                 description: Número de registros por página.
 *                 default: 10
 *               offset:
 *                 type: integer
 *                 description: Índice inicial da paginação.
 *                 default: 0
 *     responses:
 *       '200':
 *         description: Lista de transações retornada com sucesso.
 *       '400':
 *         description: Parâmetros inválidos.
 *       '403':
 *         description: Acesso não autorizado à conta.
 *       '404':
 *         description: Conta não encontrada.
 *       '500':
 *         description: Erro interno do servidor.
 */

export default router;