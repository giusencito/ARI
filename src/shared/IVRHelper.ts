export const opcionConfirmar = 'Si es correcto marque 1 - sino marque 2';
export const montoRound = (monto: number): number => {
  return monto === null ? 0 : Math.round(monto * 100) / 100;
};
export function groupBy<T, K extends keyof any>(
  array: T[],
  key: (item: T) => K,
): Record<K, T[]> {
  return array.reduce(
    (result, item) => {
      const groupKey = key(item);
      if (!result[groupKey]) {
        result[groupKey] = [];
      }
      result[groupKey].push(item);
      return result;
    },
    {} as Record<K, T[]>,
  );
}
export const ImpuestoVehicular = '';
export const ImpuestoPredial = 'Imp. Predial';
export const Arbitrios = 'Arbitrios';
export const Multatributaria = '';
export const fortmatText = (plate: string): string => {
  if (!plate) return plate;

  console.log(`[DEBUG] fortmatText entrada: "${plate}"`);

  // Remover cada tipo de caracter por separado para máxima claridad
  let cleaned = plate.replace(/\s/g, '');
  console.log(`[DEBUG] después de remover espacios: "${cleaned}"`);

  cleaned = cleaned.replace(/\./g, '');
  console.log(`[DEBUG] después de remover puntos: "${cleaned}"`);

  cleaned = cleaned.replace(/,/g, '');
  cleaned = cleaned.replace(/-/g, '');

  const result = cleaned.toUpperCase();
  console.log(`[DEBUG] fortmatText salida: "${result}"`);

  return result;
};
export const joinText = (text: string): string => {
  if (!text) return text;

  // Separar cada caracter con comas para pausas más largas en TTS
  const caracteres = text.split('');
  return caracteres.join(', ');
};