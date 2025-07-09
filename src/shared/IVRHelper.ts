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
  const normal = plate.replace(
    /\b([A-Z0-9]+(?:[\s\.,\-]+[A-Z0-9]+)+)\b/gi,
    (match) => match.replace(/[\s\.,\-]/g, ''),
  );
  return normal.toUpperCase();
};
export const joinText = (text: string): string => {
  if (!text) return text;
  const cambio = text.replace(/(.)/g, '$1 ').trim();
  return cambio;
};
