const { Wallets } = require('fabric-network');
const fs = require('fs');
const path = require('path');

async function setupWallet() {
    const walletPath = path.join(__dirname, '..', 'wallet');
    const wallet = await Wallets.newFileSystemWallet(walletPath);

    // Admin 사용자 인증서 경로
    const adminCertPath = '/home/minsujo/fabric-network/organizations/peerOrganizations/cfs1.example.com/users/Admin@cfs1.example.com/msp/signcerts/Admin@cfs1.example.com-cert.pem';

    // keystore 디렉토리에서 private key 찾기
    const keystorePath = '/home/minsujo/fabric-network/organizations/peerOrganizations/cfs1.example.com/users/Admin@cfs1.example.com/msp/keystore';
    const keystoreFiles = fs.readdirSync(keystorePath);
    const keyFile = keystoreFiles.find(file => file.endsWith('_sk'));
    const adminKeyPath = path.join(keystorePath, keyFile);

    console.log('Using certificate:', adminCertPath);
    console.log('Using private key:', adminKeyPath);

    // 인증서 파일 읽기
    const certificate = fs.readFileSync(adminCertPath).toString();
    const privateKey = fs.readFileSync(adminKeyPath).toString();

    // 지갑에 admin 추가
    const adminIdentity = {
        credentials: {
            certificate: certificate,
            privateKey: privateKey,
        },
        mspId: 'CFS1MSP',
        type: 'X.509',
    };

    await wallet.put('admin', adminIdentity);
    console.log('Successfully added admin to wallet');

    // appUser도 admin과 같은 인증서로 생성 (개발용)
    await wallet.put('appUser', adminIdentity);
    console.log('Successfully added appUser to wallet');

    // 지갑 내용 확인
    const identities = await wallet.list();
    console.log('Wallet contents:', identities);
}

setupWallet().catch(console.error);