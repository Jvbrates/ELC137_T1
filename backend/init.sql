-- Habilitar a extensão para funções de criptografia e UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========= TIPOS ENUM PARA MAIOR CONSISTÊNCIA =========

CREATE TYPE TIPO_ROLE AS ENUM ('cliente', 'gerente');
CREATE TYPE TIPO_STATUS_CONTA AS ENUM ('ATIVA', 'BLOQUEADA', 'ENCERRADA');
CREATE TYPE TIPO_TRANSACAO AS ENUM ('TRANSFERENCIA', 'DEPOSITO', 'SAQUE', 'PAGAMENTO_EMPRESTIMO', 'CONCESSAO_EMPRESTIMO');
CREATE TYPE TIPO_CARTAO AS ENUM ('VIRTUAL', 'DEBITO');
CREATE TYPE TIPO_STATUS_CARTAO AS ENUM ('ATIVO', 'BLOQUEADO', 'CANCELADO');
CREATE TYPE TIPO_STATUS_EMPRESTIMO AS ENUM ('SOLICITADO', 'APROVADO', 'REPROVADO', 'ATIVO', 'QUITADO');

-- ========= TABELA DE CLIENTE  =========
CREATE TABLE cliente (
    documento VARCHAR(18) PRIMARY KEY, -- Chave Primária
    primeiro_nome VARCHAR(50) NOT NULL,
    sobrenome_razao_social VARCHAR(100) NOT NULL,
    senha_hash VARCHAR(255) NOT NULL,
    is_pessoa_juridica BOOLEAN NOT NULL DEFAULT FALSE,
    role TIPO_ROLE NOT NULL DEFAULT 'cliente',
    foto_identidade_url VARCHAR(255),
    data_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ -- Para exclusão lógica (soft delete)
);

-- ========= TABELA DE CONTA  =========
CREATE TABLE conta (
    id BIGSERIAL PRIMARY KEY,
    cliente_documento VARCHAR(18) NOT NULL,
    numero_conta VARCHAR(20) UNIQUE NOT NULL,
    agencia VARCHAR(10) NOT NULL,
    saldo NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    status TIPO_STATUS_CONTA NOT NULL DEFAULT 'ATIVA',
    data_abertura TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_cliente
        FOREIGN KEY(cliente_documento)
        REFERENCES cliente(documento)
        ON DELETE CASCADE,

    CONSTRAINT chk_saldo_nao_negativo
        CHECK (saldo >= 0)
);

-- ========= TABELA DE TRANSACAO  =========
CREATE TABLE transacao (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conta_origem_id BIGINT,
    conta_destino_id BIGINT,
    valor NUMERIC(15, 2) NOT NULL,
    tipo TIPO_TRANSACAO NOT NULL,
    descricao TEXT,
    data_hora TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_conta_origem
        FOREIGN KEY(conta_origem_id)
        REFERENCES conta(id),

    CONSTRAINT fk_conta_destino
        FOREIGN KEY(conta_destino_id)
        REFERENCES conta(id),

    CONSTRAINT chk_origem_ou_destino
        CHECK (conta_origem_id IS NOT NULL OR conta_destino_id IS NOT NULL),

    CONSTRAINT chk_valor_positivo
        CHECK (valor > 0)
);

-- ========= TABELA DE EMPRESTIMO  =========
CREATE TABLE emprestimo (
    id BIGSERIAL PRIMARY KEY,
    conta_id BIGINT NOT NULL,
    valor_solicitado NUMERIC(15, 2) NOT NULL,
    taxa_juros_mensal NUMERIC(5, 4) NOT NULL,
    numero_parcelas INTEGER NOT NULL,
    status TIPO_STATUS_EMPRESTIMO NOT NULL DEFAULT 'SOLICITADO',
    data_solicitacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_conta_emprestimo
        FOREIGN KEY(conta_id)
        REFERENCES conta(id)
);

-- ========= TABELA DE CARTAO  =========
CREATE TABLE cartao (
    id BIGSERIAL PRIMARY KEY,
    conta_id BIGINT NOT NULL,
    numero_hash VARCHAR(255) UNIQUE NOT NULL,
    cvv_hash VARCHAR(255) NOT NULL,
    nome_titular VARCHAR(100) NOT NULL,
    data_validade DATE NOT NULL,
    tipo TIPO_CARTAO NOT NULL,
    status TIPO_STATUS_CARTAO NOT NULL DEFAULT 'ATIVO',
    data_emissao TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_conta_cartao
        FOREIGN KEY(conta_id)
        REFERENCES conta(id)
);

-- Índices para otimizar buscas comuns
CREATE INDEX idx_transacao_conta_origem ON transacao(conta_origem_id);
CREATE INDEX idx_transacao_conta_destino ON transacao(conta_destino_id);
CREATE INDEX idx_conta_cliente_documento ON conta(cliente_documento);

-- =======================================================
-- ========= GERAÇÃO DE DADOS INICIAIS (SEED) =========
-- =======================================================
DO $$
DECLARE
    v_cliente_documento VARCHAR(18);
    v_conta_id BIGINT;
    v_conta_destino_id BIGINT;
    v_primeiro_nome TEXT;
    v_sobrenome TEXT;
    nomes TEXT[] := ARRAY['Ana', 'Bruno', 'Carla', 'Daniel', 'Eduarda', 'Fábio', 'Gabriela', 'Henrique', 'Isabela', 'João'];
    sobrenomes TEXT[] := ARRAY['Silva', 'Souza', 'Costa', 'Santos', 'Oliveira', 'Pereira', 'Rodrigues', 'Almeida', 'Nascimento', 'Lima'];

BEGIN
    RAISE NOTICE '=== Iniciando a população completa do banco de dados ===';
    
    -- Inserir um gerente
    INSERT INTO cliente (documento, primeiro_nome, sobrenome_razao_social, senha_hash, role)
    VALUES ('111.111.111-11', 'Gerente', 'Principal', crypt('senha_gerente', gen_salt('bf')), 'gerente');

    -- Gerar 10 Clientes com contas, cartões e empréstimos
    RAISE NOTICE 'Gerando 10 clientes e seus dados...';
    FOR i IN 1..10 LOOP
        v_primeiro_nome := nomes[1 + floor(random() * 10)];
        v_sobrenome := sobrenomes[1 + floor(random() * 10)];
        v_cliente_documento := LPAD((11111111110 + i)::TEXT, 11, '0'); -- CPF Fictício

        INSERT INTO cliente (documento, primeiro_nome, sobrenome_razao_social, senha_hash)
        VALUES (v_cliente_documento, v_primeiro_nome, v_sobrenome, crypt('senha' || i, gen_salt('bf')))
        RETURNING documento INTO v_cliente_documento;

        INSERT INTO conta (cliente_documento, numero_conta, agencia, saldo)
        VALUES (v_cliente_documento, (10000 + i)::TEXT || '-' || (floor(random() * 9) + 1)::TEXT, '0001', round((random() * 5000 + 500)::numeric, 2))
        RETURNING id INTO v_conta_id;

        INSERT INTO cartao (conta_id, numero_hash, cvv_hash, nome_titular, data_validade, tipo)
        VALUES (v_conta_id, md5(random()::text || clock_timestamp()::text), md5(floor(random() * 900 + 100)::text), v_primeiro_nome || ' ' || v_sobrenome, current_date + (interval '3 year' * (1 + floor(random() * 3))), 'DEBITO');

        INSERT INTO emprestimo (conta_id, valor_solicitado, taxa_juros_mensal, numero_parcelas, status)
        VALUES (v_conta_id, round((random() * 10000 + 1000)::numeric, 2), round((random() * 0.04 + 0.01)::numeric, 4), (12 * (1 + floor(random() * 4)))::INT, (ARRAY['APROVADO', 'ATIVO', 'QUITADO', 'SOLICITADO'])[1 + floor(random() * 4)]::TIPO_STATUS_EMPRESTIMO);
    END LOOP;

    -- Gerar 50 Transações aleatórias
    RAISE NOTICE 'Gerando 50 transações...';
    FOR i IN 1..50 LOOP
        SELECT id INTO v_conta_id FROM conta ORDER BY random() LIMIT 1;
        SELECT id INTO v_conta_destino_id FROM conta WHERE id <> v_conta_id ORDER BY random() LIMIT 1;

        IF v_conta_destino_id IS NOT NULL THEN
            INSERT INTO transacao (conta_origem_id, conta_destino_id, valor, tipo, descricao)
            VALUES (v_conta_id, v_conta_destino_id, round((random() * 200 + 10)::numeric, 2), 'TRANSFERENCIA', 'Transferência entre contas #' || i);
        END IF;
    END LOOP;

    RAISE NOTICE '=== População de dados finalizada com sucesso! ===';
END $$;