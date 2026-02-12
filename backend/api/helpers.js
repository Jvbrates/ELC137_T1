import jwt from 'jsonwebtoken';
const JWT_SECRET = process.env.JWT_SECRET || 'seu-segredo-super-secreto-para-desenvolvimento';

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
const authenticateToken = (req, res, next) => {
  console.log("Autenticação");
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user; // user.documento e user.role
    next();
  });
  console.log("Erro na autenticação");
};


const normalizeDocument = (doc = '') => doc.replace(/[^\d]/g, '');

export { authenticateToken, normalizeDocument };