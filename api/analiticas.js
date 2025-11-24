
const { createClient } = require('@supabase/supabase-js');
const { TIEMPO_MAXIMO_DENTRO = 3600 } = process.env; 
 
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function getStartDate(periodo) {
    const today = new Date();
    if (periodo === "hoy") {
        return today.toISOString().split('T')[0];
    }
    if (periodo === "semana") {
        const firstDayOfWeek = new Date(today.setDate(today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1))); // Asumiendo Lunes como primer día
        return firstDayOfWeek.toISOString().split('T')[0];
    }
    if (periodo === "mes") {
        return new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    }
    // Por defecto, la semana
    const firstDayOfWeek = new Date(today.setDate(today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1)));
    return firstDayOfWeek.toISOString().split('T')[0];
}

module.exports = async (req, res) => {
    try {
        const { periodo, fecha_desde, fecha_hasta, sucursal_id } = req.query;

        let query = supabase.from('historico').select('employee_id, name, hora_entrada, tiempo_dentro_segundos');
        
        
        query = query.not('hora_salida', 'is', null); 
        if (sucursal_id) query = query.eq('sucursal_id', sucursal_id);

        if (fecha_desde && fecha_hasta) {
            query = query.gte('hora_entrada', `${fecha_desde}T00:00:00`);
            query = query.lte('hora_salida', `${fecha_hasta}T23:59:59`);
        } else {
            const startDate = getStartDate(periodo);
            query = query.gte('hora_entrada', `${startDate}T00:00:00`);
        }

        const { data, error } = await query;
        if (error) throw error;

        let total_ingresos = data.length;
        let total_excedidos = 0;
        let total_segundos = 0;
        const resumen_trabajador_map = {};
        const histograma = {"0-15m": 0, "15-30m": 0, "30-45m": 0, "45-60m": 0, ">60m": 0};
        const heatmap_data = {}; 
        
        for (const row of data) {
            const tiempo = row.tiempo_dentro_segundos;
            if (tiempo === null) {
                total_ingresos -= 1; continue;
            }
            
            total_segundos += tiempo;
            const emp_id = row.employee_id;
            
            if (!resumen_trabajador_map[emp_id]) {
                resumen_trabajador_map[emp_id] = {"name": row.name, "employee_id": emp_id, "total_segundos": 0, "total_ingresos": 0, "total_excedidos": 0};
            }
            
            resumen_trabajador_map[emp_id].total_segundos += tiempo;
            resumen_trabajador_map[emp_id].total_ingresos += 1;
            
            if (tiempo > TIEMPO_MAXIMO_DENTRO) {
                total_excedidos += 1;
                resumen_trabajador_map[emp_id].total_excedidos += 1;
            }

            if (tiempo <= 900) histograma["0-15m"]++;
            else if (tiempo <= 1800) histograma["15-30m"]++;
            else if (tiempo <= 2700) histograma["30-45m"]++;
            else if (tiempo <= 3600) histograma["45-60m"]++;
            else histograma[">60m"]++;
            
            try {
                const dt_entrada = new Date(row.hora_entrada);
                const dia_semana = dt_entrada.getUTCDay().toString();
                const hora = dt_entrada.getUTCHours();
                if (!heatmap_data[dia_semana]) heatmap_data[dia_semana] = {};
                if (!heatmap_data[dia_semana][hora]) heatmap_data[dia_semana][hora] = 0;
                heatmap_data[dia_semana][hora]++;
            } catch (e) {}
        }
        
        const avg_general = (total_ingresos > 0) ? (total_segundos / total_ingresos) : 0;
        const resumen_trabajador = Object.values(resumen_trabajador_map).map(r => ({
            ...r,
            promedio_segundos: (r.total_ingresos > 0) ? (r.total_segundos / r.total_ingresos) : 0,
            tiempo_total: r.total_segundos
        }));
        
        const pareto_source = resumen_trabajador.sort((a, b) => b.total_excedidos - a.total_excedidos);
        let cumulative_sum = 0;
        const pareto_data = pareto_source.map(item => {
            cumulative_sum += item.total_excedidos;
            const cumulative_percent = (total_excedidos > 0) ? (cumulative_sum / total_excedidos * 100) : 0;
            return { name: item.name, excedidos: item.total_excedidos, cumulative_percent: cumulative_percent };
        });

        res.status(200).json({
            kpis: {
                tiempo_promedio_general: avg_general,
                total_ingresos: total_ingresos,
                total_excedidos: total_excedidos,
                cumplimiento_seguridad: (total_ingresos > 0) ? ((total_ingresos - total_excedidos) / total_ingresos * 100) : 100,
                tasa_excedidos: (total_ingresos > 0) ? (total_excedidos / total_ingresos * 100) : 0
            },
            resumen_trabajador: resumen_trabajador,
            excedidos_trabajador: Object.fromEntries(resumen_trabajador.map(r => [r.employee_id, r.total_excedidos])),
            graficos: { histograma, heatmap: heatmap_data, pareto: pareto_data }
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};