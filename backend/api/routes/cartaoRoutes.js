import express from 'express';
import {authenticateToken, normalizeDocument} from '../helpers.js';
import pool from '../dbConnection.js';
const router = express.Router();

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
router.delete('/:id', authenticateToken, async (req, res) => {
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


export default router;