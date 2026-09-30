/**
 * 沃钱包 Token 采集 —— Loon http-response 脚本
 *
 * 匹配 epay.10010.com：token 本来就在请求头里，直接从 header 抓，
 * 不用像浏览器那样去页面里翻 sessionStorage。
 *
 * 产出格式与打卡脚本第1张表 A列要求一致：
 *   {"mobile":"...","tokenid":"...","authinfo":"...","bizchannelinfo":"..."}
 *
 * 存储：最多保留 MAX_ACCOUNTS 个账号，同一个账号只留最新的 token
 * 通知：仅在 token 变化时触发，避免每个请求都弹
 */

const CFG = {
  STORE_KEY: 'wopay_accounts',
  MAX_ACCOUNTS: 10,

  // 本地通知（token 变化时弹一次）
  NOTIFY: true,

  // 把凭证推到 Bark，用 autoCopy 直接进 iOS 剪贴板，方便粘到表1。
  // 注意：走的是 api.day.app 第三方服务器，等于把登录凭证经手一遍。
  // 不想这样就把这里改成 false，改从 Loon 的持久化存储里取。
  BARK_PUSH: true,
  BARK_KEY: 'BwWtwMxDSyy9owLHNkox8H',
  BARK_SERVER: 'https://api.day.app',

  // 日志表里显示的手机号是否打码
  MASK_MOBILE: true
}

function readList() {
  try {
    const raw = $persistentStore.read(CFG.STORE_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch (e) {
    return []
  }
}

function maskMobile(mobile) {
  if (!CFG.MASK_MOBILE || !mobile || mobile.length !== 11) return mobile || '未知账号'
  return mobile.slice(0, 3) + '****' + mobile.slice(7)
}

function notify(acc) {
  if (!CFG.NOTIFY) return
  $notification.post(
    '沃钱包凭证已更新',
    maskMobile(acc.mobile),
    'token 尾号 …' + acc.tokenid.slice(-8) + '，已存入本机'
  )
}

function pushBark(acc) {
  if (!CFG.BARK_PUSH || !CFG.BARK_KEY) return
  $httpClient.post({
    url: CFG.BARK_SERVER + '/push',
    timeout: 10000,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_key: CFG.BARK_KEY,
      title: '沃钱包凭证',
      body: maskMobile(acc.mobile),
      group: '沃钱包',
      autoCopy: '1',
      copy: JSON.stringify(acc),
      isArchive: '1'
    })
  }, function () {})
}

;(function () {
  try {
    const raw = $request.headers || {}
    const h = {}
    Object.keys(raw).forEach(function (k) { h[k.toLowerCase()] = raw[k] })

    const tokenid = h['tokenid']
    const authinfo = h['authinfo']
    // 没有这几个头就不是登录态的接口，直接放行
    if (!tokenid || !authinfo || !h['bizchannelinfo']) return $done({})

    // bizchannelinfo 归一化成打卡接口要的样子，rptId 必须原样保留（服务端签发的票据）
    let biz = {}
    try { biz = JSON.parse(h['bizchannelinfo']) } catch (e) { biz = {} }
    if (!biz.rptId) return $done({})

    const bizStr = JSON.stringify({
      bizChannelCode: '212',
      disriBiz: 'vipcenter',
      unionSessionId: '',
      stType: '',
      stDesmobile: '',
      source: '',
      rptId: biz.rptId,
      ticket: '',
      tongdunTokenId: biz.tongdunTokenId || '',
      xindunTokenId: biz.xindunTokenId || ''
    })

    // 手机号从响应体里捞，捞不到就沿用同 tokenid 的旧值
    let mobile = ''
    const body = ($response && $response.body) || ''
    if (typeof body === 'string') {
      const m = body.match(/"userMobile"\s*:\s*"(\d{11})"/) ||
                body.match(/"mobile"\s*:\s*"(\d{11})"/)
      if (m) mobile = m[1]
    }

    let list = readList()
    const old = list.filter(function (x) {
      return x.tokenid === tokenid || (mobile && x.mobile === mobile)
    })[0]

    if (!mobile && old && old.mobile) mobile = old.mobile

    const acc = {
      mobile: mobile,
      tokenid: tokenid,
      authinfo: authinfo,
      bizchannelinfo: bizStr
    }

    const changed = !old || old.tokenid !== tokenid || old.authinfo !== authinfo ||
                    (!old.mobile && mobile)

    if (changed) {
      list = list.filter(function (x) {
        return x.tokenid !== tokenid && !(mobile && x.mobile === mobile)
      })
      list.unshift(acc)
      list = list.slice(0, CFG.MAX_ACCOUNTS)
      $persistentStore.write(JSON.stringify(list), CFG.STORE_KEY)

      notify(acc)
      pushBark(acc)
    }
  } catch (e) {
    console.log('wopay-token 出错：' + e)
  }
  $done({})
})()
