const clientPins: Record<string, string> = {
  Lariana: '400',
};

export const DEFAULT_CLIENT = 'Lariana';

export const getClientPin = (client: string): string | undefined =>
  clientPins[client.trim()];
