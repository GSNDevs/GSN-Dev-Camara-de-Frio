const { createClient } = require('@supabase/supabase-js');
const math = require('math'); // Nota: 'math' no se usa en este snippet, pero se mantiene del original.

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = async (req, res) => {
    try {
        // Agregamos el parámetro 'exportar'
        const { page = 1, id_empleado, nombre, fecha_desde, fecha_hasta, sucursal_id, exportar } = req.query;

        const PAGE_SIZE = 50;
        const offset = (parseInt(page) - 1) * PAGE_SIZE;

        let query = supabase
            .from('historico')
            .select('id, employee_id, name, hora_entrada, hora_salida, tiempo_dentro_segundos, sucursal:sucursal_id(nombre)', { count: 'exact' })
            .order('id', { ascending: false });

        // Aplicar filtros
        if (id_empleado) query = query.eq('employee_id', id_empleado);
        if (nombre) query = query.ilike('name', `%${nombre}%`);
        if (fecha_desde) query = query.gte('hora_entrada', `${fecha_desde}T00:00:00`);
        if (fecha_hasta) query = query.lte('hora_entrada', `${fecha_hasta}T23:59:59`);
        if (sucursal_id) query = query.eq('sucursal_id', sucursal_id);

        // LÓGICA DE EXPORTACIÓN:
        // Si 'exportar' es true, NO aplicamos la paginación para traer todos los registros.
        if (exportar !== 'true') {
            query = query.range(offset, offset + PAGE_SIZE - 1);
        }

        const { data, error, count } = await query;
        if (error) throw error;

        // Si es exportación, retornamos la data directamente para procesar rápido
        if (exportar === 'true') {
             return res.status(200).json({ data: data });
        }

        const total_pages = Math.ceil(count / PAGE_SIZE);

        res.status(200).json({
            data: data,
            pagination: {
                total_records: count,
                current_page: parseInt(page),
                total_pages: total_pages,
                page_size: PAGE_SIZE
            }
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};