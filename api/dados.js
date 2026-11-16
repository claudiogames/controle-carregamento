import { createClient } from '@supabase/supabase-js';

// As chaves vêm das Variáveis de Ambiente da Vercel (100% ocultas)
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const supabaseSec = createClient(
    process.env.SUPABASE_URL_SEC,
    process.env.SUPABASE_KEY_SEC
);

const TABELA = 'controle_faltas_portao';

export default async function handler(req, res) {
    // Permite requisições apenas do seu próprio domínio (opcional)
    res.setHeader('Content-Type', 'application/json');

    try {
        // 1. BUSCAR DADOS DO DIA (GET)
        if (req.method === 'GET') {
            const { data_operacao } = req.query;
            if (!data_operacao) return res.status(400).json({ error: 'Data obrigatória' });

            const { data, error } = await supabase
                .from(TABELA)
                .select('*')
                .eq('data_operacao', data_operacao)
                .order('id', { ascending: true });

            if (error) throw error;
            return res.status(200).json({ data });
        }

        // 2. AÇÕES DE ESCRITA E CRUZAMENTO (POST)
        if (req.method === 'POST') {
            const { acao, payload, id, uid, data_operacao, codigo } = req.body;

            // INSERIR NOVA LINHA
            if (acao === 'inserir') {
                const { data, error } = await supabase
                    .from(TABELA)
                    .insert([payload])
                    .select('id');
                if (error) throw error;
                return res.status(200).json({ id: data?.[0]?.id });
            }

            // ATUALIZAR LINHA EXISTENTE
            if (acao === 'atualizar') {
                const q = supabase.from(TABELA).update(payload);
                const { data, error } = await (id ? q.eq('id', id) : q.eq('uid', uid)).select('id');
                if (error) throw error;
                return res.status(200).json({ updated: data?.length > 0, id: data?.[0]?.id });
            }

            // DELETAR LINHA
            if (acao === 'deletar') {
                const q = supabase.from(TABELA).delete();
                const { error } = await (id ? q.eq('id', id) : q.eq('uid', uid));
                if (error) throw error;
                return res.status(200).json({ deleted: true });
            }

            // CRUZAR SSCC (REPOSIÇÃO E RASGADAS)
            if (acao === 'cruzar') {
                let msg = '';
                const { data: rep } = await supabase
                    .from('registros_sscc')
                    .select('*')
                    .ilike('sscc', `%${codigo}`)
                    .limit(5);

                if (rep && rep.length > 0) {
                    const achado = rep[0];
                    msg = `Caixa localizada em Reposição: ${achado.categoria || 'Reposição'}${achado.rastro ? ` (${achado.rastro})` : ''}`;
                } else {
                    const { data: rasg } = await supabase
                        .from(TABELA)
                        .select('portao, sscc')
                        .eq('sscc', codigo)
                        .eq('data_operacao', data_operacao)
                        .like('observacao', 'Rasgada (%')
                        .limit(1);

                    if (rasg && rasg.length > 0) {
                        msg = `ALERTA: Caixa localizada em Rasgadas (Portão ${rasg[0].portao})`;
                    }
                }
                return res.status(200).json({ msg });
            }

            // SINCRONIZAR OCORRÊNCIAS NO BANCO SECUNDÁRIO
            if (acao === 'sync_ocorrencias') {
                const { data: existente } = await supabaseSec
                    .from('ocorrencias_turno1')
                    .select('id')
                    .eq('data', data_operacao)
                    .maybeSingle();

                if (existente) {
                    await supabaseSec
                        .from('ocorrencias_turno1')
                        .update(payload)
                        .eq('id', existente.id);
                } else {
                    await supabaseSec
                        .from('ocorrencias_turno1')
                        .insert([payload]);
                }
                return res.status(200).json({ synced: true });
            }
        }

        return res.status(405).json({ error: 'Método não suportado' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
