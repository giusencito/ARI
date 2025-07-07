export class TramiteDto {
  tramiteNro: string;
  fechaPresentacion: Date;
  tipoTramiteDes: number;
  estadoDesc: string;
  resolucionNro: string;
  fechaResolucion: null | string;
  codigoResultado: null | string;
  resultadoDes: string;
  obsEjecucion: string;
  estadoNotificaRes: null | string;
  fechaNotificaRes: null | string;
}
