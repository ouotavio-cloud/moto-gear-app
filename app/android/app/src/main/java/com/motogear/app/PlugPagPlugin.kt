package com.motogear.app

import android.Manifest
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.PermissionState
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPag
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagActivationData
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagEventData
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagEventListener
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagPaymentData
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagTransactionResult

@CapacitorPlugin(
    name = "PlugPag",
    permissions = [
        Permission(
            alias = "bluetooth",
            strings = [
                Manifest.permission.BLUETOOTH,
                Manifest.permission.BLUETOOTH_ADMIN,
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ]
        )
    ]
)
class PlugPagPlugin : Plugin() {

    private var plugPag: PlugPag? = null

    @PluginMethod
    fun inicializar(call: PluginCall) {
        val codigoAtivacao = call.getString("codigoAtivacao") ?: ""
        try {
            plugPag = PlugPag(activity)
            if (codigoAtivacao.isNotEmpty()) {
                val activationData = PlugPagActivationData(codigoAtivacao)
                val result = plugPag!!.initializeAndActivatePinpad(activationData)
                if (result.result != PlugPag.RET_OK) {
                    call.reject("Falha ao ativar a maquininha. Código: ${result.result} - ${result.errorMessage ?: ""}")
                    return
                }
            }
            call.resolve(JSObject().put("ok", true))
        } catch (e: Exception) {
            call.reject("Erro ao inicializar PlugPag: ${e.message}", e)
        }
    }

    @PluginMethod
    fun pagar(call: PluginCall) {
        if (!temPermissoes()) {
            saveCall(call)
            requestAllPermissions(call, "permissaoCallback")
            return
        }
        executarPagamento(call)
    }

    @PermissionCallback
    private fun permissaoCallback(call: PluginCall) {
        if (!temPermissoes()) {
            call.reject("Permissões de Bluetooth negadas. Vá em Configurações do celular e permita o Bluetooth para o Moto Gear.")
            return
        }
        executarPagamento(call)
    }

    private fun executarPagamento(call: PluginCall) {
        val valorCentavos = call.getInt("valorCentavos") ?: 0
        val tipo = call.getString("tipo") ?: "debito"
        val parcelas = call.getInt("parcelas") ?: 1

        if (valorCentavos <= 0) {
            call.reject("Valor inválido.")
            return
        }

        if (plugPag == null) {
            call.reject("PlugPag não inicializado. Chame inicializar() antes.")
            return
        }

        val tipoTransacao = when (tipo) {
            "credito_vista" -> PlugPag.TYPE_CREDITO
            "credito_parc" -> PlugPag.TYPE_CREDITO
            "debito" -> PlugPag.TYPE_DEBITO
            "voucher" -> PlugPag.TYPE_VOUCHER
            "pix" -> PlugPag.TYPE_PIX
            else -> PlugPag.TYPE_DEBITO
        }

        val installmentType = when (tipo) {
            "credito_parc" -> PlugPag.INSTALLMENT_TYPE_PARC_COMPRADOR
            else -> PlugPag.INSTALLMENT_TYPE_A_VISTA
        }

        Thread {
            try {
                val paymentData = PlugPagPaymentData(
                    tipoTransacao,
                    valorCentavos,
                    installmentType,
                    parcelas,
                    "MOTOGEAR${System.currentTimeMillis()}"
                )

                plugPag!!.setEventListener(object : PlugPagEventListener {
                    override fun onEvent(eventData: PlugPagEventData) {
                        val evento = JSObject()
                        evento.put("codigo", eventData.eventCode)
                        evento.put("mensagem", eventData.customMessage ?: "")
                        notifyListeners("plugpagEvento", evento)
                    }
                })

                val resultado: PlugPagTransactionResult = plugPag!!.doPayment(paymentData)

                val ret = JSObject()
                if (resultado.result == PlugPag.RET_OK) {
                    ret.put("aprovado", true)
                    ret.put("transacaoId", resultado.transactionId ?: "")
                    ret.put("transacaoCode", resultado.transactionCode ?: "")
                    ret.put("data", resultado.date ?: "")
                    ret.put("hora", resultado.time ?: "")
                    ret.put("bandeira", resultado.cardBrand ?: "")
                    ret.put("bin", resultado.bin ?: "")
                    ret.put("holder", resultado.holder ?: "")
                    ret.put("nsu", resultado.nsu ?: "")
                    ret.put("autoCode", resultado.autoCode ?: "")
                    call.resolve(ret)
                } else {
                    ret.put("aprovado", false)
                    ret.put("mensagem", resultado.message ?: "Pagamento recusado")
                    ret.put("errorCode", resultado.errorCode ?: "")
                    call.reject(resultado.message ?: "Pagamento recusado")
                }
            } catch (e: Exception) {
                call.reject("Erro no pagamento: ${e.message}", e)
            }
        }.start()
    }

    @PluginMethod
    fun abortar(call: PluginCall) {
        try {
            plugPag?.abort()
            call.resolve(JSObject().put("ok", true))
        } catch (e: Exception) {
            call.reject("Erro ao abortar: ${e.message}", e)
        }
    }

    @PluginMethod
    fun disponivel(call: PluginCall) {
        val ret = JSObject()
        ret.put("disponivel", plugPag != null)
        ret.put("nativo", true)
        call.resolve(ret)
    }

    private fun temPermissoes(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return getPermissionState("bluetooth") == PermissionState.GRANTED
        }
        return true
    }
}
