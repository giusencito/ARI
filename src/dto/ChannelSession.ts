export class ChannelSession {
  channelId: string;           // ID único del canal de Asterisk
  consultType: string;         // "placa" o "papeleta"
  currentState: string;        // En qué paso está: "recording", "waiting_confirmation", etc.
  extractedData: string;       // Lo que extrajo el STT: "ABC123" o "E123456"
  recordingName: string;       // Nombre del archivo de grabación
  createdAt: Date;            // Para limpiar sesiones viejas

  constructor(channelId: string) {
    this.channelId = channelId;
    this.consultType = '';
    this.currentState = 'initial';
    this.extractedData = '';
    this.recordingName = '';
    this.createdAt = new Date();
  }

  // Métodos útiles para cambiar estados
  startRecording(type: 'placa' | 'papeleta', recordingName: string) {
    this.consultType = type;
    this.currentState = 'recording';
    this.recordingName = recordingName;
  }

  setExtractedData(data: string) {
    this.extractedData = data;
    this.currentState = 'waiting_confirmation';
  }

  confirm() {
    this.currentState = 'confirmed';
  }

  reject() {
    this.currentState = 'rejected';
  }

  isExpired(): boolean {
    // Sesión expira después de 10 minutos
    const now = new Date();
    const diff = now.getTime() - this.createdAt.getTime();
    return diff > 10 * 60 * 1000; // 10 minutos
  }
}