const LineAPI = require('./api');
const request = require('request');
const fs = require('fs');
const unirest = require('unirest');
const webp = require('webp-converter');
const path = require('path');
const rp = require('request-promise');
const config = require('./config');
const { Message, OpType, Location } = require('../curve-thrift/line_types');
//let exec = require('child_process').exec;

class LINE extends LineAPI {
    constructor() {
        super();
        this.receiverID = '';
        this.checkReader = [];
        this.spamName = [];        
        this.stateStatus = {
            cancel: 0,
            kick: 0,
        };
        this.messages;
        this.payload;
        this.stateUpload =  {
                file: '',
                name: '',
                group: '',
                sender: ''
            }
    }

    get myBot() {
        const bot = ['u6dc040137eac599ca446f80f45bbd93c'];
        return bot; 
    }
    
    get payload() {
        if(typeof this.messages !== 'undefined'){
            return (this.messages.text !== null) ? this.messages.text.split(' ').splice(1) : '' ;
        }
        return false;
    }    

    isAdminOrBot(param) {
        return this.myBot.includes(param);
    }

    getOprationType(operations) {
        for (let key in OpType) {
            if(operations.type == OpType[key]) {
                if(key !== 'NOTIFIED_UPDATE_PROFILE') {
                    console.info(`[* ${operations.type} ] ${key} `);
                }
            }
        }
    }

    poll(operation) {
        if(operation.type == 25 || operation.type == 26) {
            let message = new Message(operation.message);
            this.receiverID = message.to = (operation.message.to === this.myBot[0]) ? operation.message.from : operation.message.to ;
            Object.assign(message,{ ct: operation.createdTime.toString() });
            this.textMessage(message)
        }

        if(operation.type == 13 && this.stateStatus.cancel == 1) {
            this._cancel(operation.param2,operation.param1);
            
        }

        if(operation.type == 11 && !this.isAdminOrBot(operation.param2) && this.stateStatus.qrp == 1) {
            this._kickMember(operation.param1,[operation.param2]);
            this.messages.to = operation.param1;
            this.qrOpenClose();
        }

        if(operation.type == 19) { //ada kick
            // op1 = group nya
            // op2 = yang 'nge' kick
            // op3 = yang 'di' kick
            if(this.isAdminOrBot(operation.param3)) {
                this._invite(operation.param1,[operation.param3]);
            }
            if(!this.isAdminOrBot(operation.param2)){
                this._kickMember(operation.param1,[operation.param2]);
            } 

        }
        

        if(operation.type == 5) { // diadd
let loveagler = new Message();
loveagler.to = operation.param1;
loveagler.text = "Thanks for add me!\n\nPowered by Anu"
this._client.sendMessage(0,loveagler);
}       

        if(operation.type == 55){ //ada reader
            const idx = this.checkReader.findIndex((v) => {
                if(v.group == operation.param1) {
                    return v
                }
            })
            if(this.checkReader.length < 1 || idx == -1) {
                this.checkReader.push({ group: operation.param1, users: [operation.param2], timeSeen: [operation.param3] });
            } else {
                for (var i = 0; i < this.checkReader.length; i++) {
                    if(this.checkReader[i].group == operation.param1) {
                        if(!this.checkReader[i].users.includes(operation.param2)) {
                            this.checkReader[i].users.push(operation.param2);
                            this.checkReader[i].timeSeen.push(operation.param3);
                        }
                    }
                }
            }
        }

        if(operation.type == 13) { // diinvite
            if(this.isAdminOrBot(operation.param2)) {
                return this._acceptGroupInvitation(operation.param1);
            } else {
                return this._cancel(operation.param1,this.myBot);
            }
        }
        this.getOprationType(operation);
    }

    command(msg, reply) {
        if(this.messages.text !== null) {
            if(this.messages.text === msg.trim()) {
                if(typeof reply === 'function') {
                    reply();
                    return;
                }
                if(Array.isArray(reply)) {
                    reply.map((v) => {
                        this._sendMessage(this.messages, v);
                    })
                    return;
                }
                return this._sendMessage(this.messages, reply);
            }
        }
    }

    async getProfile() {
        let { displayName } = await this._myProfile();
        return displayName;
    }


    async cancelMember() {
        let groupID;
        if(this.payload.length > 0) {
            let [ groups ] = await this._findGroupByName(this.payload.join(' '));
            groupID = groups.id;
        } 
        let gid = groupID || this.messages.to;
        let { listPendingInvite } = await this.searchGroup(gid);
        if(listPendingInvite.length > 0){
            this._cancel(gid,listPendingInvite);
        }
    }

    async searchGroup(gid) {
        let listPendingInvite = [];
        let thisgroup = await this._getGroups([gid]);
        if(thisgroup[0].invitee !== null) {
            listPendingInvite = thisgroup[0].invitee.map((key) => {
                return key.mid;
            });
        }
        let listMember = thisgroup[0].members.map((key) => {
            return { mid: key.mid, dn: key.displayName };
        });

        return { 
            listMember,
            listPendingInvite
        }
    }

    OnOff() {
        if(this.isAdminOrBot(this.messages.from)){
            let [ actions , status ] = this.messages.text.split(' ');
            const action = actions.toLowerCase();
            const state = status.toLowerCase() == 'on' ? 1 : 0;
            this.stateStatus[action] = state;
            this._sendMessage(this.messages,`Status: \n${JSON.stringify(this.stateStatus)}`);
        } else {
            this._sendMessage(this.messages,`You Are Not Admin`);
        }
    }

    mention(listMember) {
        let mentionStrings = [''];
        let mid = [''];
        for (var i = 0; i < listMember.length; i++) {
            mentionStrings.push('@'+listMember[i].displayName+'\n');
            mid.push(listMember[i].mid);
        }
        let strings = mentionStrings.join('');
        let member = strings.split('@').slice(1);
        
        let tmp = 0;
        let memberStart = [];
        let mentionMember = member.map((v,k) => {
            let z = tmp += v.length + 1;
            let end = z - 1;
            memberStart.push(end);
            let mentionz = `{"S":"${(isNaN(memberStart[k - 1] + 1) ? 0 : memberStart[k - 1] + 1 ) }","E":"${end}","M":"${mid[k + 1]}"}`;
            return mentionz;
        })
        return {
            names: mentionStrings.slice(1),
            cmddata: { MENTION: `{"MENTIONEES":[${mentionMember}]}` }
        }
    }

    async leftGroupByName(name) {
        let payload = name || this.payload.join(' ');
        let gid = await this._findGroupByName(payload);
        for (let i = 0; i < gid.length; i++) {
            this._leaveGroup(gid[i].id);
        }
        return;
    }
    
    async recheck(cs,group) {
        let users;
        for (var i = 0; i < cs.length; i++) {
            if(cs[i].group == group) {
                users = cs[i].users;
            }
        }
        
        let contactMember = await this._getContacts(users);
        return contactMember.map((z) => {
                return { displayName: z.displayName, mid: z.mid };
            });
    }

    removeReaderByGroup(groupID) {
        const groupIndex = this.checkReader.findIndex(v => {
            if(v.group == groupID) {
                return v
            }
        })

        if(groupIndex != -1) {
            this.checkReader.splice(groupIndex,1);
        }
    }

    async getSpeed() {
        let curTime = Date.now() / 9000;     //do not change this or error
        await this._sendMessage(this.messages, 'Read Time');
        const rtime = (Date.now() / 9000) - curTime;    //do not change this or error
        await this._sendMessage(this.messages, `${rtime} Second`);
        return;
    }

    vn() {
        this._sendFile(this.messages,`${__dirname}/../download/${this.payload.join(' ')}.m4a`,3);
    }

    checkKernel() {
        exec('uname -a',(err, sto) => {
            if(err) {
                this._sendMessage(this.messages, err);
                return
            }
            this._sendMessage(this.messages, sto);
            return;
        });
    }

    setReader() {
        this._sendMessage(this.messages, `Setpoint... type '.recheck' for lookup !`);
        this.removeReaderByGroup(this.messages.to);
        return;
    }

    clearall() {
        this._sendMessage(this.messages, `Reseted !`);
        this.checkReader = [];
        return
    }

    creator() {
        let msg = {
            text:null,
            contentType: 13,
            contentPreview: null,
            contentMetadata: 
            { mid: 'u6dc040137eac599ca446f80f45bbd93c',
            displayName: 'Ziad' }
        }
        Object.assign(this.messages,msg);
        this._sendMessage(this.messages);
    }
    
    resetStateUpload() {
        this.stateUpload = {
            file: '',
            name: '',
            group: '',
            sender: ''
        };
    }

    prepareUpload() {
        this.stateUpload = {
            file: true,
            name: this.payload.join(' '),
            group: this.messages.to,
            sender: this.messages.from
        };
        this._sendMessage(this.messages,`select pict/video for upload ${this.stateUpload.name}`);
        return;
    }
    
    async doUpload({ id, contentType }) {
        let url = `https://obs-sg.line-apps.com/talk/m/download.nhn?oid=${id}`;
        await this._download(url,this.stateUpload.name, contentType);
        this.messages.contentType = 0;
        this._sendMessage(this.messages,`Upload ${this.stateUpload.name} success !!`);
        this.resetStateUpload()
        return;
    }

    searchLocalImage() {
        let name = this.payload.join(' ');
        let dirName = `${__dirname}/../download/${name}.jpg`;
        try {
            this._sendImage(this.messages,dirName);
        } catch (error) {
             this._sendImage(this.messages,`No Photo #${name} Uploaded `);
        }
        return ;
        
    }

    async joinQr() {
        const [ ticketId ] = this.payload[0].split('g/').splice(-1);
        let { id } = await this._findGroupByTicket(ticketId);
        await this._acceptGroupInvitationByTicket(id,ticketId);
        return;
    }

    async qrOpenClose() {
        let updateGroup = await this._getGroup(this.messages.to);
        updateGroup.preventJoinByTicket = true;
        if(typeof this.payload !== 'undefined') {
            let [ type ] = this.payload;
            if(type === 'open') {
                updateGroup.preventJoinByTicket = false;
                const groupUrl = await this._reissueGroupTicket(this.messages.to)
                this._sendMessage(this.messages,`Line group = line://ti/g/${groupUrl}`);
            }
        }
        await this._updateGroup(updateGroup);
        return;
    }

    spamGroup() {
        if(this.isAdminOrBot(this.messages.from) && this.payload[0] !== 'kill') {
            let s = [];
            for (let i = 0; i < this.payload[1]; i++) {
                let name = `${Math.ceil(Math.random() * 1000)}${i}`;
                this.spamName.push(name);
                this._createGroup(name,[this.payload[0]]);
            }
            return;
        } 
        for (let z = 0; z < this.spamName.length; z++) {
            this.leftGroupByName(this.spamName[z]);
        }
        return true;
    }

    checkIP() {
        exec(`wget ipinfo.io/${this.payload[0]} -qO -`,(err, res) => {
            if(err) {
                this._sendMessage(this.messages,'Error Please Install Wget');
                return 
            }
            const result = JSON.parse(res);
            if(typeof result.error == 'undefined') {
                const { org, country, loc, city, region } = result;
                try {
                    const [latitude, longitude ] = loc.split(',');
                    let location = new Location();
                    Object.assign(location,{ 
                        title: `Location:`,
                        address: `${org} ${city} [ ${region} ]\n${this.payload[0]}`,
                        latitude: latitude,
                        longitude: longitude,
                        phone: null 
                    })
                    const Obj = { 
                        text: 'Location',
                        location : location,
                        contentType: 0,
                    }
                    Object.assign(this.messages,Obj)
                    this._sendMessage(this.messages,'Location');
                } catch (err) {
                    this._sendMessage(this.messages,'Not Found');
                }
            } else {
                this._sendMessage(this.messages,'Location Not Found , Maybe di dalem goa');
            }
        })
        return;
    }

    async rechecks() {
        let rec = await this.recheck(this.checkReader,this.messages.to);
        const mentions = await this.mention(rec);
        this.messages.contentMetadata = mentions.cmddata;
        await this._sendMessage(this.messages,mentions.names.join(''));
        return;
    }
    
    async tagall() {
        let rec = await this._getGroup(this.messages.to);
        const mentions = await this.mention(rec.members);
        this.messages.contentMetadata = mentions.cmddata;
        await this._sendMessage(this.messages,mentions.names.join(''));
        return;
    }    

    async kickAll() {
        let groupID;
        if(this.stateStatus.kick == 1 && this.isAdminOrBot(this.messages.from)) {
            let target = this.messages.to;
            if(this.payload.length > 0) {
                let [ groups ] = await this._findGroupByName(this.payload.join(' '));
                groupID = groups.id;
            }
            let { listMember } = await this.searchGroup(groupID || target);
            for (var i = 0; i < listMember.length; i++) {
                if(!this.isAdminOrBot(listMember[i].mid)){
                    this._kickMember(groupID || target,[listMember[i].mid])
                }
            }
            return;
        } 
        return this._sendMessage(this.messages, ' Kick Failed check status or admin only !');
    }

    async checkIG() {
        try {
            let { userProfile, userName, bio, media, follow } = await this._searchInstagram(this.payload[0]);
            await this._sendFileByUrl(this.messages,userProfile);
            await this._sendMessage(this.messages, `${userName}\n\nBIO:\n${bio}\n\n\uDBC0 ${follow} \uDBC0`)
            if(Array.isArray(media)) {
                for (let i = 0; i < media.length; i++) {
                    await this._sendFileByUrl(this.messages,media[i]);
                }
            } else {
                this._sendMessage(this.messages,media);
            }
        } catch (error) {
            this._sendMessage(this.messages,`Error: ${error}`);
        }
        return;
    }
    
    siganteng() {      //do not change this or error! 
    	 this._sendMessage(this.messages,`Agler? Kgk Kenal Gw ^?^`)
    }
    
    myhelp() {
         this._sendMessage(this.messages, `┏━━━━ೋ• ❄ •ೋ━━━━━┓
    ❁Command For Selfbot❁   
┗━━━━ೋ• ❄ •ೋ━━━━━┛
[🐯] Gift tema 1/4
[🐯] Gift sticker 1/4
[🐯] Kick on/off
[🐯] Cancel on/off
[🐯] Qrp on/off
[🐯] Cancel
[🐯] Kickall
[🐯] Cancelall
[🐯] Tagall
[🐯] Set
[🐯] Recheck
[🐯] Clearall
[🐯] Myid
[🐯] Ig usrname
[🐯] Qr
[🐯] Ip
[🐯] Joinqr
[🐯] Spam
[🐯] Creator
[🐯] Kernel
[🐯] Upload
[🐯] Pap
[🐯] Vn
┏━━━━ೋ• ❄ •ೋ━━━━━┓
☬         ❁ANu Selfbot❁             ☬
┗━━━━ೋ• ❄ •ೋ━━━━━┛

━━━━━━━━━━━━━━━━━━━━┓
Support by: Anu
━━━━━━━━━━━━━━━━━━━━┛`);
    }

    async textMessage(messages) {
        this.messages = messages;
        let payload = (this.messages.text !== null) ? this.messages.text.split(' ').splice(1).join(' ') : '' ;
        let receiver = messages.to;
        let sender = messages.from;
        
        this.command('Halo', ['halo juga','ini siapa?']);
        this.command('Pagi', ['pagi juga','jangan lupa makan ya']);
        this.command('Siang', ['siang juga','jangan lupa istirahat ya']);
        this.command('Sore', ['sore juga','mandi sana kamu bau']);
        this.command('Malam', ['selamat malam','jangan lupa tidur','mimpi indah ya']);
        this.command('kamu siapa', this.getProfile.bind(this));
        this.command('Status', `Your Status: ${JSON.stringify(this.stateStatus)}`);
        this.command(`Left ${payload}`, this.leftGroupByName.bind(this));
        this.command('speed', this.getSpeed.bind(this));
        this.command('Speed', this.getSpeed.bind(this));
        this.command('Kernel', this.checkKernel.bind(this));
        this.command(`Kick ${payload}`, this.OnOff.bind(this));
        this.command(`Cancel ${payload}`, this.OnOff.bind(this));
        this.command(`Qrp ${payload}`, this.OnOff.bind(this));
        this.command(`Kickall ${payload}`,this.kickAll.bind(this));
        this.command(`Cancelall ${payload}`, this.cancelMember.bind(this));
        this.command(`Set`,this.setReader.bind(this));
        this.command(`Recheck`,this.rechecks.bind(this));
        this.command(`Clearall`,this.clearall.bind(this));
        this.command('Myid',`Your ID: ${messages.from}`)
        this.command(`Ip ${payload}`,this.checkIP.bind(this))
        this.command(`Ig ${payload}`,this.checkIG.bind(this))
        this.command(`Qr ${payload}`,this.qrOpenClose.bind(this))
        this.command(`Joinqr ${payload}`,this.joinQr.bind(this));
        this.command(`Spam ${payload}`,this.spamGroup.bind(this));
        this.command(`Creator`,this.creator.bind(this));
        this.command(`Help`,this.myhelp.bind(this));
        this.command(`Agler`,this.siganteng.bind(this));
        this.command(`Tagall`,this.tagall.bind(this));
        this.command(`help`,this.myhelp.bind(this));

        this.command(`Pap ${payload}`,this.searchLocalImage.bind(this));
        this.command(`Upload ${payload}`,this.prepareUpload.bind(this));
        this.command(`Vn ${payload}`,this.vn.bind(this));

        if(messages.contentType == 13) {
            messages.contentType = 0;
            if(!this.isAdminOrBot(messages.contentMetadata.mid)) {
                this._sendMessage(messages,messages.contentMetadata.mid);
            }
            return;
        }
  
  if (messages.text == `Noob`){
        messages.contentType = 0;
       this._sendMessage(messages, "sent sticker",messages.contentMetadata={'STKID': '404',
                                    'STKPKGID': '1',
                                    'STKVER': '100'},messages.contentType=7);
     }

  if (messages.text == `noob`){
        messages.contentType = 0;
       this._sendMessage(messages, "sent sticker",messages.contentMetadata={'STKID': '404',
                                    'STKPKGID': '1',
                                    'STKVER': '100'},messages.contentType=7);
     }

  if (messages.text == 'Gift tema 1'){
        messages.contentType = 0;
       this._sendMessage(messages, "gift sent",messages.contentMetadata={'PRDID': 'a0768339-c2d3-4189-9653-2909e9bb6f58',
                                    'PRDTYPE': 'THEME',
                                    'MSGTPL': '6'},messages.contentType=9);
     }

  if (messages.text == 'Gift tema 2'){
        messages.contentType = 0;
       this._sendMessage(messages, "gift sent",messages.contentMetadata={'PRDID': 'ec4a14ea-7437-407b-aee7-96b1cbbc1b4b',
                                    'PRDTYPE': 'THEME',
                                    'MSGTPL': '5'},messages.contentType=9);
     }

  if (messages.text == 'Gift tema 3'){
        messages.contentType = 0;
       this._sendMessage(messages, "gift sent",messages.contentMetadata={'PRDID': 'd4f09a5f-29df-48ac-bca6-a204121ea165',
                                    'PRDTYPE': 'THEME',
                                    'MSGTPL': '7'},messages.contentType=9);
     }

  if (messages.text == 'Gift tema 4'){
        messages.contentType = 0;
       this._sendMessage(messages, "gift sent",messages.contentMetadata={'PRDID': '25e24851-994d-4636-9463-597387ec7b73',
                                    'PRDTYPE': 'THEME',
                                    'MSGTPL': '8'},messages.contentType=9);
     }



  if (messages.text == 'Gift sticker 1'){
        messages.contentType = 0;
       this._sendMessage(messages, "gift sent",messages.contentMetadata={'STKPKGID': '9778',
                                    'PRDTYPE': 'STICKER',
                                    'MSGTPL': '1'},messages.contentType=9);
     }

  if (messages.text == 'Gift sticker 2'){
        messages.contentType = 0;
       this._sendMessage(messages, "gift sent",messages.contentMetadata={'STKPKGID': '1699',
                                    'PRDTYPE': 'STICKER',
                                    'MSGTPL': '2'},messages.contentType=9);
     }

  if (messages.text == 'Gift sticker 3'){
        messages.contentType = 0;
       this._sendMessage(messages, "gift sent",messages.contentMetadata={'STKPKGID': '1073',
                                    'PRDTYPE': 'STICKER',
                                    'MSGTPL': '3'},messages.contentType=9);
     }

  if (messages.text == 'Gift sticker 4'){
        messages.contentType = 0;
       this._sendMessage(messages, "gift sent",messages.contentMetadata={'STKPKGID': '1405277',
                                    'PRDTYPE': 'STICKER',
                                    'MSGTPL': '4'},messages.contentType=9);
     }        

        if(this.stateUpload.group == messages.to && [1,2,3].includes(messages.contentType)) {
            if(sender === this.stateUpload.sender) {
                this.doUpload(messages);
                return;
            } else {
                messages.contentType = 0;
                this._sendMessage(messages,'Wrong Sender !! Reseted');
            }
            this.resetStateUpload();
            return;
        }
        
        // if(cmd == 'Apakah') {
        //      let optreply_jawab=['Iya','Bisa Jadi','Tidak','Mungkin','Siapa yang tau']
        //      let random5 = Math.floor(Math.random()*optreply_jawab.length);
        //      let reply_jawab=(optreply_jawab[random5]);                            
        //      this._sendMessage(seq, `${reply_jawab}`);
        // }
              
        // if(cmd == 'Kapan') {
        //      let optreply_jawab=['kapan kapan','besok','Mungkin nanti']
        //      let random3 = Math.floor(Math.random()*optreply_jawab.length);
        //      let reply_jawab=(optreply_jawab[random3]);                            
        //      this._sendMessage(seq, `${reply_jawab}`);
        // }

        // if(cmd == 'Mengapa') {
        //      let optreply_jawab=['tidak tahu','mungkin karna dia jones','Siapa yang tau','mungkin dia sering coli']
        //      let random4 = Math.floor(Math.random()*optreply_jawab.length);
        //      let reply_jawab=(optreply_jawab[random4]);                            
        //      this._sendMessage(seq, `${reply_jawab}`);
        // }             


        // if(cmd == 'lirik') {
        //     let lyrics = await this._searchLyrics(payload);
        //     this._sendMessage(seq,lyrics);
        // }

    }

}

module.exports = new LINE();