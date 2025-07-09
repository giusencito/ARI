import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IVR_SESSION_EXPIRY_TIME } from 'src/shared/Constants';

export class ChannelSession {
  channelId: string;           // ID único del canal de Asterisk
  consultType: string;         // "placa" o "papeleta"
  currentState: string;        // En qué paso está: "recording", "waiting_confirmation", etc.
  extractedData: string;       // Lo que extrajo el STT: "ABC123" o "E123456"
  recordingName: string;       // Nombre del archivo de grabación
  createdAt: Date;            // Para limpiar sesiones viejas
  retryCount: number;         // Contador de reintentos para STT

  constructor(channelId: string) {
    this.channelId = channelId;
    this.consultType = '';
    this.currentState = 'initial';
    this.extractedData = '';
    this.recordingName = '';
    this.createdAt = new Date();
    this.retryCount = 0;
  }

  // Métodos útiles para cambiar estados
  startRecording(type: 'placa' | 'papeleta', recordingName: string) {
    this.consultType = type;
    this.currentState = 'recording';
    this.recordingName = recordingName;
    // No resetear retryCount aquí para mantener el contador
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
    // Resetear datos extraídos cuando se rechaza
    this.extractedData = '';
  }

  resetForRetry() {
    this.currentState = 'initial';
    this.extractedData = '';
    this.recordingName = '';
    // Mantener retryCount para tracking
  }

  isExpired(configService?: ConfigService): boolean {
    // Tiempo de expiración configurable (por defecto 10 minutos)
    const expiryTime = configService?.get<number>(IVR_SESSION_EXPIRY_TIME) ?? 600000; // 10 min

    const now = new Date();
    const diff = now.getTime() - this.createdAt.getTime();
    return diff > expiryTime;
  }

  hasExceededMaxRetries(maxRetries: number = 3): boolean {
    return this.retryCount >= maxRetries;
  }
}