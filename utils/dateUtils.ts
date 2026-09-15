export const formatToDDMMYYYY = (dateString: string, lang: string): string => {
  const date = new Date(dateString);
  const options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  };
  // Use 'es-ES' for Spanish and 'en-GB' for English to get DD/MM/YYYY format
  const locale = lang === 'es' ? 'es-ES' : 'en-GB';
  return date.toLocaleDateString(locale, options);
};
