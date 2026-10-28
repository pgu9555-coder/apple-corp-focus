/* Focus Machine v0.4 BANK protocol: Arduino Uno LED test ONLY.
   No servo motor or candy mechanism is driven. 115200 baud.
   Uploading/physical operation has NOT been verified for this release.
   Sixteen recent claim IDs are recorded in EEPROM before the LED flashes.
   The extension never retries an uncertain claim, including after a reset.
*/
#include <Arduino.h>
#include <EEPROM.h>
#include <string.h>
char input[151];uint8_t used=0;bool overflow=false;
unsigned long ledUntil=0;
const uint8_t SLOTS=16;
uint16_t crc16(const char* text){uint16_t crc=0xffff;while(*text){crc^=(uint16_t)(uint8_t)*text++<<8;for(uint8_t i=0;i<8;i++)crc=(crc&0x8000)?(crc<<1)^0x1021:crc<<1;}return crc;}
bool claimId(const char* value){if(strlen(value)!=32)return false;for(uint8_t i=0;i<32;i++)if(!((value[i]>='0'&&value[i]<='9')||(value[i]>='a'&&value[i]<='f')))return false;return true;}
bool decimal(const char* value){if(!*value)return false;while(*value){if(*value<'0'||*value>'9')return false;value++;}return true;}
void reply(const char* seq,const char* type,const char* id,const char* value){char body[116];snprintf(body,sizeof(body),"F1|%s|%s|%s|%s",seq,type,id,value);char checksum[5];snprintf(checksum,sizeof(checksum),"%04X",crc16(body));Serial.print(body);Serial.print('|');Serial.println(checksum);}
bool remembered(const char* id){for(uint8_t slot=0;slot<SLOTS;slot++){const int base=4+slot*33;if(EEPROM.read(base)!=0xa5)continue;bool equal=true;for(uint8_t i=0;i<32;i++)if(EEPROM.read(base+1+i)!=(uint8_t)id[i]){equal=false;break;}if(equal)return true;}return false;}
void remember(const char* id){uint8_t slot=EEPROM.read(2);if(slot>=SLOTS)slot=0;const int base=4+slot*33;EEPROM.update(base,0);for(uint8_t i=0;i<32;i++)EEPROM.update(base+1+i,id[i]);EEPROM.update(base,0xa5);EEPROM.update(2,(slot+1)%SLOTS);}
void process(char* frame){
  char* checksum=strrchr(frame,'|');if(!checksum||strlen(checksum+1)!=4)return;*checksum++=0;
  for(uint8_t i=0;i<4;i++)if(!((checksum[i]>='0'&&checksum[i]<='9')||(checksum[i]>='A'&&checksum[i]<='F')))return;
  if(crc16(frame)!=(uint16_t)strtoul(checksum,NULL,16))return;
  char* fields[5];char* save=NULL;for(uint8_t i=0;i<5;i++){fields[i]=strtok_r(i==0?frame:NULL,"|",&save);if(!fields[i])return;}
  if(strtok_r(NULL,"|",&save)||strcmp(fields[0],"F1")||!decimal(fields[1])||strlen(fields[1])>10)return;
  const char* seq=fields[1];const char* command=fields[2];const char* id=fields[3];const char* value=fields[4];
  if(strcmp(id,"0")&& !claimId(id))return;
  if(!strcmp(command,"HELLO")){reply(seq,"ACK",id,"READY_BANK_TEST");return;}
  if(strcmp(command,"CLAIM")){reply(seq,"ERR",id,"UNKNOWN_COMMAND");return;}
  if(!claimId(id)||strcmp(value,"1")){reply(seq,"ERR",id,"BAD_CLAIM");return;}
  if(remembered(id)){reply(seq,"ACK",id,"SIMULATED");return;}
  remember(id); // Persist before producing any observable reward action.
  digitalWrite(LED_BUILTIN,HIGH);ledUntil=millis()+1000;
  reply(seq,"ACK",id,"SIMULATED");
}
void setup(){pinMode(LED_BUILTIN,OUTPUT);digitalWrite(LED_BUILTIN,LOW);Serial.begin(115200);if(EEPROM.read(0)!=0x46||EEPROM.read(1)!=0x34){for(uint8_t i=0;i<SLOTS;i++)EEPROM.update(4+i*33,0);EEPROM.update(2,0);EEPROM.update(0,0x46);EEPROM.update(1,0x34);}}
void loop(){while(Serial.available()){const char c=(char)Serial.read();if(c=='\n'){if(!overflow){input[used]=0;process(input);}used=0;overflow=false;}else if(c!='\r'){if(used<sizeof(input)-1&&!overflow)input[used++]=c;else overflow=true;}}if(ledUntil&&(long)(millis()-ledUntil)>=0){digitalWrite(LED_BUILTIN,LOW);ledUntil=0;}}
