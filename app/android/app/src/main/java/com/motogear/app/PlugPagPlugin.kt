package com.motogear.app

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.os.Build
import br.com.uol.pagseguro.plugpag.PlugPag
import br.com.uol.pagseguro.plugpag.PlugPagAuthenticationListener
import br.com.uol.pagseguro.plugpag.PlugPagDevice
import br.com.uol.pagseguro.plugpag.PlugPagPaymentData
import br.com.uol.pagseguro.plugpag.PlugPagTransactionResult
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.util.concurrent.atomic.AtomicBoolean

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
    companion object {
        private const val PREFS = "motogear_plugpag"
        private const val DEVICE_KEY = "device_id"
    }

    private val operacaoEmAndamento = AtomicBoolean(false)
    private lateinit var plugPag: PlugPag

    override fun load() {
        super.load()
        plugPag = PlugPag(activity.applicationContext)
        val versao = try {
            activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: "2.0"
        } catch (_: Exception) {
            "2.0"
        }
        plugPag.setVersionName("Moto Gear", versao.take(10))
    }

    @PluginMethod
    fun disponivel(call: PluginCall) {
        val deviceId = dispositivoSelecionado()
        call.resolve(JSObject()
            .put("disponivel", deviceId.isNotBlank())
            .put("nativo", true)
            .put("autenticado", try { plugPag.isAuthenticated } catch (_: Exception) { false })
            .put("dispositivoSelecionado", deviceId)
            .put("operacaoEmAndamento", operacaoEmAndamento.get())
            .put("sdk", "4.15.1"))
    }

    @PluginMethod
    fun listarDispositivos(call: PluginCall) {
        if (!temPermissoes()) {
            saveCall(call)
            requestAllPermissions(call, "listarAposPermissao")
            return
        }
        resolverDispositivos(call)
    }

    @PermissionCallback
    private fun listarAposPermissao(call: PluginCall) {
        if (!temPermissoes()) {
            call.reject("Permissão de Bluetooth negada. Libere Dispositivos próximos para conectar a maquininha.", "BLUETOOTH_PERMISSION_DENIED")
            return
        }
        resolverDispositivos(call)
    }

    @Suppress("MissingPermission")
    private fun resolverDispositivos(call: PluginCall) {
        try {
            val adapter = BluetoothAdapter.getDefaultAdapter()
            if (adapter == null) {
                call.reject("Este celular não possui Bluetooth.", "BLUETOOTH_UNAVAILABLE")
                return
            }
            if (!adapter.isEnabled) {
                call.reject("Ative o Bluetooth do celular e tente novamente.", "BLUETOOTH_DISABLED")
                return
            }

            val selecionado = dispositivoSelecionado()
            val devices = JSArray()
            adapter.bondedDevices.sortedBy { it.name ?: it.address }.forEach { device ->
                devices.put(JSObject()
                    .put("id", device.address)
                    .put("nome", device.name ?: "Maquininha ${device.address.takeLast(5)}")
                    .put("selecionado", device.address == selecionado))
            }
            call.resolve(JSObject().put("dispositivos", devices).put("selecionado", selecionado))
        } catch (e: Exception) {
            call.reject("Não foi possível ler os dispositivos pareados: ${e.message}", "BLUETOOTH_LIST_ERROR", e)
        }
    }

    @PluginMethod
    fun selecionarDispositivo(call: PluginCall) {
        val id = call.getString("id")?.trim().orEmpty()
        if (id.isBlank()) {
            call.reject("Selecione uma maquininha.", "DEVICE_REQUIRED")
            return
        }
        activity.getSharedPreferences(PREFS, 0).edit().putString(DEVICE_KEY, id).apply()
        call.resolve(JSObject().put("ok", true).put("id", id))
    }

    @PluginMethod
    fun inicializar(call: PluginCall) {
        Thread {
            try {
                if (plugPag.isAuthenticated) {
                    call.resolve(JSObject().put("ok", true).put("autenticado", true))
                    return@Thread
                }

                activity.runOnUiThread {
                    try {
                        plugPag.requestAuthentication(object : PlugPagAuthenticationListener {
                            override fun onSuccess() {
                                call.resolve(JSObject().put("ok", true).put("autenticado", true))
                            }

                            override fun onError() {
                                call.reject("Não foi possível autenticar no PagBank.", "AUTHENTICATION_FAILED")
                            }
                        })
                    } catch (e: Exception) {
                        call.reject("Erro ao abrir a autenticação PagBank: ${e.message}", "AUTHENTICATION_ERROR", e)
                    }
                }
            } catch (e: Exception) {
                call.reject("Erro ao verificar a autenticação PagBank: ${e.message}", "AUTHENTICATION_ERROR", e)
            }
        }.start()
    }

    @PluginMethod
    fun pagar(call: PluginCall) {
        if (!temPermissoes()) {
            saveCall(call)
            requestAllPermissions(call, "pagarAposPermissao")
            return
        }
        executarPagamento(call)
    }

    @PermissionCallback
    private fun pagarAposPermissao(call: PluginCall) {
        if (!temPermissoes()) {
            call.reject("Permissão de Bluetooth negada. Libere Dispositivos próximos para usar a maquininha.", "BLUETOOTH_PERMISSION_DENIED")
            return
        }
        executarPagamento(call)
    }

    private fun executarPagamento(call: PluginCall) {
        val valorCentavos = call.getInt("valorCentavos") ?: 0
        val tipo = call.getString("tipo") ?: ""
        val parcelas = call.getInt("parcelas") ?: 1
        val deviceId = dispositivoSelecionado()

        if (valorCentavos <= 0) {
            call.reject("Valor inválido.", "INVALID_AMOUNT")
            return
        }
        if (deviceId.isBlank()) {
            call.reject("Selecione primeiro uma maquininha Bluetooth.", "DEVICE_REQUIRED")
            return
        }
        if (tipo !in setOf("debito", "credito_vista", "credito_parc_comprador", "credito_parc_vendedor", "pix")) {
            call.reject("Forma de pagamento inválida.", "INVALID_PAYMENT_TYPE")
            return
        }
        if (tipo.startsWith("credito_parc") && parcelas !in 2..12) {
            call.reject("Escolha entre 2 e 12 parcelas.", "INVALID_INSTALLMENTS")
            return
        }
        if (!operacaoEmAndamento.compareAndSet(false, true)) {
            call.reject("Já existe um pagamento em andamento.", "PAYMENT_IN_PROGRESS")
            return
        }

        Thread {
            try {
                if (!plugPag.isAuthenticated) {
                    call.reject("Entre na sua conta PagBank antes de cobrar.", "AUTHENTICATION_REQUIRED")
                    return@Thread
                }

                val tipoTransacao = when (tipo) {
                    "debito" -> PlugPag.TYPE_DEBITO
                    "pix" -> PlugPag.TYPE_PIX
                    else -> PlugPag.TYPE_CREDITO
                }
                val installmentType = when (tipo) {
                    "credito_parc_comprador" -> PlugPag.INSTALLMENT_TYPE_PARC_COMPRADOR
                    "credito_parc_vendedor" -> PlugPag.INSTALLMENT_TYPE_PARC_VENDEDOR
                    else -> PlugPag.INSTALLMENT_TYPE_A_VISTA
                }
                val numeroParcelas = if (tipo.startsWith("credito_parc")) parcelas else 1
                // A documentação limita userReference a menos de 10 caracteres.
                val referencia = "MG${(System.currentTimeMillis() / 1000).toString().takeLast(7)}"
                val paymentData = PlugPagPaymentData(tipoTransacao, valorCentavos, installmentType, numeroParcelas, referencia)

                plugPag.setEventListener { event ->
                    notifyListeners("plugpagEvento", JSObject()
                        .put("codigo", event.eventCode)
                        .put("mensagem", event.customMessage ?: ""))
                    PlugPag.RET_OK
                }

                val dispositivo = if (tipo == "pix") PlugPagDevice(true) else PlugPagDevice(deviceId)
                val conexao = plugPag.initBTConnection(dispositivo)
                if (conexao != PlugPag.RET_OK) {
                    call.reject("Não foi possível conectar à maquininha (código $conexao). Confira se ela está ligada, próxima e pareada.", "CONNECTION_$conexao")
                    return@Thread
                }

                val resultado: PlugPagTransactionResult = plugPag.doPayment(paymentData)
                if (resultado.result == PlugPag.RET_OK) {
                    call.resolve(JSObject()
                        .put("aprovado", true)
                        .put("transacaoId", resultado.transactionId ?: "")
                        .put("transacaoCode", resultado.transactionCode ?: "")
                        .put("data", resultado.date ?: "")
                        .put("hora", resultado.time ?: "")
                        .put("bandeira", resultado.cardBrand ?: "")
                        .put("bin", resultado.bin ?: "")
                        .put("holder", resultado.holder ?: "")
                        .put("nsu", resultado.hostNsu ?: "")
                        .put("valorCentavos", valorCentavos)
                        .put("tipo", tipo)
                        .put("parcelas", numeroParcelas))
                } else {
                    call.reject(resultado.message ?: "Pagamento não aprovado", resultado.errorCode ?: "PAYMENT_REJECTED")
                }
            } catch (e: Exception) {
                call.reject("Erro no pagamento: ${e.message}", "PAYMENT_ERROR", e)
            } finally {
                operacaoEmAndamento.set(false)
            }
        }.start()
    }

    @PluginMethod
    fun abortar(call: PluginCall) {
        Thread {
            try {
                plugPag.abort()
                call.resolve(JSObject().put("ok", true))
            } catch (e: Exception) {
                call.reject("Erro ao cancelar: ${e.message}", "ABORT_ERROR", e)
            }
        }.start()
    }

    private fun dispositivoSelecionado(): String =
        activity.getSharedPreferences(PREFS, 0).getString(DEVICE_KEY, "").orEmpty()

    private fun temPermissoes(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
        getPermissionState("bluetooth") == PermissionState.GRANTED
}
