export const months = [
  '',
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
export const getDateString = (date: string) => {
  const [day, month, year] = date.trim().split('/');
  const monthName = months[parseInt(month, 10)];
  return `${parseInt(day, 10)} de ${monthName} de ${year}`;
};
