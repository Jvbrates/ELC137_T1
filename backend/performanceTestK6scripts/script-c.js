import http from 'k6/http';
import { check, sleep, group } from 'k6';

// -------------------------------------------------------------
// 1. CONFIGURAÇÃO BASE
// -------------------------------------------------------------
const BASE_URL = 'http://localhost:3000';
const LOGIN_CREDENTIALS = {
    documento: '11111111111', 
    senha: 'senha' 
};
const CLIENTE_DOCUMENTO = LOGIN_CREDENTIALS.documento;


// -------------------------------------------------------------
// 2. FUNÇÃO DE SETUP: Obtém o Token JWT e ID da Conta
// -------------------------------------------------------------
export function setup() {
    // 1. Login
    const loginRes = http.post(`${BASE_URL}/login`, JSON.stringify(LOGIN_CREDENTIALS), {
        headers: { 'Content-Type': 'application/json' },
        tags: { name: 'Login' },
    });

    // Confirma se o login foi bem-sucedido
    check(loginRes, { 
        'Setup: Login Sucesso (200)': (r) => r.status === 200,
        'Setup: Token Obtido': (r) => r.json() && r.json().token
    });
    const token = loginRes.json().token;
    
    // 2. Buscar ID da Conta (Necessário para Transações/Extrato)
    const contasRes = http.get(`${BASE_URL}/clientes/${CLIENTE_DOCUMENTO}/contas`, {
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}` 
        },
        tags: { name: 'SetupGetContas' }
    });

    if (!check(contasRes, { 'Setup: Contas Buscadas': (r) => r.status === 200 && r.json().length > 0 })) {
        throw new Error('Erro: Cliente não tem contas cadastradas.');
    }
    const contaId = contasRes.json()[0].id;
    
    return { token: token, contaId: contaId };
}


// -------------------------------------------------------------
// 3. OPERAÇÕES (Funções para Cenários)
// -------------------------------------------------------------

// Função que executa operações de LEITURA (GET)
export function leituraFunc(data) {
    // 1. Headers com Token
    const headers = { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${data.token}` 
    };

    group('Operacao_Leitura', function () {
        // 1. Consulta Extrato da Conta (GET /contas/{contaId}/transacoes)
        const extratoRes = http.get(`${BASE_URL}/contas/${data.contaId}/transacoes?limit=10`, { 
            tags: { name: 'GET_Extrato' }, headers 
        });
        check(extratoRes, { 'GET Extrato OK': (r) => r.status === 200 });

        // 2. Consulta Dados do Cliente (GET /clientes/{documento})
        const clienteRes = http.get(`${BASE_URL}/clientes/${CLIENTE_DOCUMENTO}`, { 
            tags: { name: 'GET_Cliente' }, headers 
        });
        check(clienteRes, { 'GET Cliente OK': (r) => r.status === 200 });
    });
    
    // Simula o Think Time para o usuário (pausa de 1 segundo)
    sleep(1); 
}


// Função que executa operações de ESCRITA (POST)
export function escritaFunc(data) {
    const headers = { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${data.token}` 
    };
    
    group('Operacao_Escrita', function () {
        // 1. Simulação de um Depósito (POST /transacoes/deposito)
        // Usa Depósito como Escrita para simplificar o payload
        const depositoPayload = JSON.stringify({
            conta_destino_id: data.contaId,
            // Valor aleatório entre 1.00 e 5.00
            valor: parseFloat((Math.random() * 4 + 1).toFixed(2)) 
        });
        
        const depositoRes = http.post(`${BASE_URL}/transacoes/deposito`, depositoPayload, { 
            tags: { name: 'POST_Deposito' }, headers 
        });
        check(depositoRes, { 'POST Depósito OK': (r) => r.status === 200 });
    });
    
    sleep(1); // Simula o Think Time
}

// -------------------------------------------------------------
// 5. CONFIGURAÇÕES DOS CENÁRIOS (Escolha APENAS UM por vez)
// -------------------------------------------------------------

// Configurações serão definidas na seção 2 do seu roteiro

export const options = {
    thresholds: {
        http_req_duration: ['p(95)<500', 'p(99)<1000'], 
        http_req_failed: ['rate<0.02'],
    },
    
    scenarios: {
        // 25 VUs para a função de Leitura
        leitura_25: {
            executor: 'constant-vus',
            exec: 'leituraFunc', 
            vus: 25, 
            duration: '30s',
        },
        // 75 VUs para a função de Escrita
        escrita_75: {
            executor: 'constant-vus',
            exec: 'escritaFunc', 
            vus: 75, 
            duration: '30s',
        },
    },
};