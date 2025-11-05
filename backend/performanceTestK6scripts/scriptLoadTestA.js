import http from "k6/http"; // requisicoes HTTP
import { check, sleep, group } from "k6";

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

// credenciais do cliente de teste
const loginCredentials = {
  documento: "11111111111",
  senha: "senha",
};
const docClient = loginCredentials.documento;

// Função setup()
// obtem o JSON Web Token e ID da conta
// o k6 executa esta função APENAS UMA VEZ no início do teste
export function setup() {
  // 1. Login
  const resLogin = http.post(
    `${BASE_URL}/login`,
    JSON.stringify(loginCredentials),
    {
      headers: { "Content-Type": "application/json" },
      tags: { name: "Login" },
    }
  );

  // Confirma se o login foi bem-sucedido
  check(resLogin, {
    "Setup: Login Sucesso (200)": (r) => r.status === 200,
    "Setup: Token Obtido": (r) => r.json() && r.json().token,
  });
  const token = resLogin.json().token;

  // 2. Buscar ID da Conta (Necessário para Transações/Extrato)
  const contasRes = http.get(`${BASE_URL}/clientes/${docClient}/contas`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    tags: { name: "SetupGetContas" },
  });

  if (
    !check(contasRes, {
      "Setup: Contas Buscadas": (r) => r.status === 200 && r.json().length > 0,
    })
  ) {
    throw new Error("Erro: Cliente não tem contas cadastradas.");
  }
  const contaId = contasRes.json()[0].id;

  return {
    token: token,
    contaId: contaId,
  };
}

/* Operações para os cenários
 * data{ token, contaId} é PASSADO AUTOMATICAMENTE para as funcoes de leitura/escrita
 * Função que executa operações de leitura */
export function readFunct(data) {
  //const { token, contaId} = data;
  // 1. Headers com Token
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${data.token}`,
  };

  group("opLeituras", function () {
    // 1. Consulta Extrato da Conta (GET /contas/{contaId}/transacoes)
    const extratoRes = http.get(
      `${BASE_URL}/contas/${data.contaId}/transacoes?limit=10`,
      {
        tags: { name: "GET_Extrato" },
        headers,
      }
    );
    check(extratoRes, { "GET Extrato OK": (r) => r.status === 200 });

    // 2. Consulta Dados do Cliente (GET /clientes/{documento})
    const clienteRes = http.get(`${BASE_URL}/clientes/${docClient}`, {
      tags: { name: "GET_Cliente" },
      headers,
    });
    check(clienteRes, { "GET Cliente OK": (r) => r.status === 200 });
  });
  // a função sleep() serve para simular um uso real ao pausar as requisições por 1 segundo
  sleep(1);
}

// funcao que so executa operacoes de escrita
export function writeFunct(data) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${data.token}`,
  };

  group("opEscritas", function () {
    // 1. Simulação de um Depósito (POST /transacoes/deposito)
    // Usa Depósito como Escrita para simplificar o payload
    const depositPayLoad = JSON.stringify({
      conta_destino_id: data.contaId,
      // Valor aleatório entre 1.00 e 5.00
      valor: parseFloat((Math.random() * 4 + 1).toFixed(2)),
    });

    const depositoRes = http.post(
      `${BASE_URL}/transacoes/deposito`,
      depositPayLoad,
      {
        tags: { name: "POST_Deposito" },
        headers,
      }
    );
    check(depositoRes, { "POST Depósito OK": (r) => r.status === 200 });
  });

  sleep(1);
}

// no objeto Options definimos os cenários (1 por vez)
export const options = {
  // Definimos thresholds (limites) baseados nas métricas obrigatórias
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"], // Latência: 95% < 500ms, 99% < 1s
    http_req_failed: ["rate<0.02"], // Taxa de erro (4xx/5xx) menor que 2%
  },

  // cenário A 50 LEITURAS - 50 ESCRITAS
  scenarios: {
    leituras50: {
      executor: "constant-vus", // mantem o numero fixo de VUs durante todo o teste
      exec: "readFunct",
      vus: 50, // representa os 50 clientes (virtual users) simultaneos
      duration: "30s", // indica que a duração do teste é de 30 segundos
    },
    escritas50: {
      executor: "constant-vus",
      exec: "writeFunct",
      vus: 50,
      duration: "30s",
    },
  },
};
